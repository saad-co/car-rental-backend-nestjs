import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { normalizeAliasValue } from "../aliases/normalize-alias.js";
import { AliasSource, PaymentAlias } from "../aliases/payment-alias.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { LlmRateLimitError } from "../llm/llm-client.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../payments/payment.entity.js";
import type { AiDriverMatcher, DriverCandidate } from "./ai-driver-matcher.js";
import { ALIAS_TYPE_BY_SOURCE, AliasIndex } from "./alias-index.js";

/** Injection token for the AI matcher (null when no LLM is configured). */
export const AI_DRIVER_MATCHER = Symbol("AI_DRIVER_MATCHER");

/** At or above: the AI's pick is assigned automatically (Saad, B51). Below: "Needs review". */
export const AUTO_ASSIGN_CONFIDENCE = 0.7;
/** At or above: the payer's name is also saved as an alias, so the next payment matches exactly (D48). */
export const LEARN_ALIAS_CONFIDENCE = 0.9;

/** What one matching run did. */
export interface MatchResult {
  assigned: number;
  review: number;
}

/**
 * The status of a payment once it has a driver (spec 6.3). Zelle waits for the bank deposit (M5); the
 * other methods are final. No ledger yet: when it exists it credits `confirmed` payments once, by key.
 */
export function statusWhenAssigned(source: PaymentSource): PaymentStatus {
  return source === PaymentSource.email_zelle
    ? PaymentStatus.reported
    : PaymentStatus.confirmed;
}

/**
 * Assigns unmatched payments to drivers (spec 6.1, D48): exact alias first, then the AI with a confidence.
 * Runs after every intake run. A payment it cannot place stays `unmatched` with the AI's suggestion, for review.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    @Inject(AI_DRIVER_MATCHER)
    private readonly ai: AiDriverMatcher | null = null,
  ) {}

  /**
   * Looks at every payment not looked at yet, oldest first. A rate limit stops the run (the rest wait for the
   * next run, B49); any other AI failure sends that one payment to review with the error.
   */
  async matchPending(limit = 50): Promise<MatchResult> {
    const result: MatchResult = { assigned: 0, review: 0 };
    const pending = await this.dataSource.getRepository(Payment).find({
      where: { status: PaymentStatus.unmatched, matchAttemptedAt: IsNull() },
      order: { createdAt: "ASC", id: "ASC" },
      take: limit,
    });
    if (pending.length === 0) return result;

    const drivers = await this.dataSource.getRepository(Driver).find();
    const aliases = await this.dataSource.getRepository(PaymentAlias).find();
    const index = AliasIndex.build(aliases, drivers);
    const candidates: DriverCandidate[] = drivers.map((driver) => ({
      id: driver.id,
      name: `${driver.firstName} ${driver.lastName}`,
      status: driver.status,
      email: driver.email,
      phone: driver.phone,
      aliases: aliases
        .filter((alias) => alias.driverId === driver.id)
        .map((alias) => ({ type: alias.type, value: alias.value })),
    }));

    for (const payment of pending) {
      const outcome = await this.matchOne(payment, index, candidates);
      result[outcome]++;
    }
    return result;
  }

  private async matchOne(
    payment: Payment,
    index: AliasIndex,
    candidates: DriverCandidate[],
  ): Promise<keyof MatchResult> {
    const hit = index.find(payment);
    if (hit) {
      await this.assign(
        payment,
        hit.driverId,
        MatchMethod.alias,
        1,
        hit.explanation,
      );
      return "assigned";
    }

    const type = ALIAS_TYPE_BY_SOURCE[payment.source];
    if (!this.ai || !type) {
      await this.toReview(
        payment,
        null,
        null,
        "No alias matched and AI matching is not available.",
      );
      return "review";
    }

    try {
      const match = await this.ai.match(
        {
          method: type,
          senderName: payment.senderName,
          senderHandle: payment.senderHandle,
          amountCents: payment.amountCents,
        },
        candidates,
      );
      if (match.driverId && match.confidence >= AUTO_ASSIGN_CONFIDENCE) {
        await this.assign(
          payment,
          match.driverId,
          MatchMethod.ai,
          match.confidence,
          match.explanation,
        );
        if (match.confidence >= LEARN_ALIAS_CONFIDENCE) {
          await this.learnAlias(payment, match.driverId);
          // The outer `type` is set here: without it the AI is never asked.
          index.add(type, normalizeAliasValue(type, payment.senderName), {
            driverId: match.driverId,
            value: payment.senderName,
          });
        }
        return "assigned";
      }
      await this.toReview(
        payment,
        match.driverId,
        match.confidence,
        match.explanation,
      );
      return "review";
    } catch (error) {
      if (error instanceof LlmRateLimitError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Payment ${payment.id}: AI matching failed: ${message}`);
      await this.toReview(
        payment,
        null,
        null,
        `AI matching failed: ${message}`,
      );
      return "review";
    }
  }

  /** Sets the driver. Only while still unmatched: an admin's assignment made meanwhile is never overwritten. */
  private async assign(
    payment: Payment,
    driverId: string,
    method: MatchMethod,
    confidence: number,
    explanation: string,
  ): Promise<void> {
    await this.dataSource.getRepository(Payment).update(
      { id: payment.id, status: PaymentStatus.unmatched, driverId: IsNull() },
      {
        driverId,
        suggestedDriverId: null,
        matchMethod: method,
        matchConfidence: confidence,
        matchExplanation: explanation,
        matchAttemptedAt: new Date(),
        status: statusWhenAssigned(payment.source),
      },
    );
  }

  /** Leaves the payment unmatched, with the AI's best guess (if any) for the admin. */
  private async toReview(
    payment: Payment,
    suggestedDriverId: string | null,
    confidence: number | null,
    explanation: string,
  ): Promise<void> {
    await this.dataSource.getRepository(Payment).update(
      { id: payment.id, status: PaymentStatus.unmatched, driverId: IsNull() },
      {
        suggestedDriverId,
        matchConfidence: confidence,
        matchExplanation: explanation,
        matchAttemptedAt: new Date(),
      },
    );
  }

  /** Saves the payer's name as the driver's alias, unless that alias already exists (for anyone). */
  private async learnAlias(payment: Payment, driverId: string): Promise<void> {
    const type = ALIAS_TYPE_BY_SOURCE[payment.source];
    if (!type) return;
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(PaymentAlias)
      .values({
        driverId,
        type,
        value: payment.senderName,
        valueNormalized: normalizeAliasValue(type, payment.senderName),
        source: AliasSource.ai_match,
      })
      .orIgnore() // ON CONFLICT DO NOTHING: an existing alias (maybe another driver's) is never changed.
      .execute();
  }
}
