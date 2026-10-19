import { addDateRange } from "../common/date-range.js";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Brackets, DataSource, EntityManager } from "typeorm";
import { normalizeAliasValue } from "../aliases/normalize-alias.js";
import { likePattern } from "../common/search.js";
import { AliasSource, PaymentAlias } from "../aliases/payment-alias.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { MAX_BACKDATE_DAYS } from "../ledger/dto/ledger-entry.dto.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { chicagoDate } from "../common/chicago-date.js";
import { assertRecentDay } from "../common/recent-day.js";
import { ALIAS_TYPE_BY_SOURCE } from "../matching/alias-index.js";
import { ListPaymentsQueryDto } from "./dto/list-payments-query.dto.js";
import {
  AssignPaymentResultDto,
  PaymentDriverDto,
  PaymentDto,
  PaymentListDto,
} from "./dto/payment.dto.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "./payment.entity.js";
import { RecordPaymentDto } from "./dto/record-payment.dto.js";

/** Statuses an admin may (re)assign from. Rejected and discrepancy payments need their own handling first. */
const ASSIGNABLE = [
  PaymentStatus.unmatched,
  PaymentStatus.reported,
  PaymentStatus.confirmed,
];

/** Reads payments for the admin screens, and lets an admin assign one to a driver. */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * One page of payments, most recent first, filtered by status, source, driver and match state, and by a search
   * (B75): the payer's name and handle, and the assigned driver's first, last or full name (ILIKE, ignoring case).
   * Built like `ApplicationsService.list`; see there for the details.
   *
   * `leftJoinAndSelect` loads the driver and the suggested driver with the payment (a LEFT JOIN keeps payments
   * that have none). With joins, TypeORM pages by first picking the page's payment ids, so `take` counts payments,
   * not joined rows.
   */
  async list(query: ListPaymentsQueryDto): Promise<PaymentListDto> {
    const builder = this.dataSource
      .getRepository(Payment)
      .createQueryBuilder("p")
      .leftJoinAndSelect("p.driver", "driver")
      .leftJoinAndSelect("p.suggestedDriver", "suggestedDriver")
      // `id` breaks ties, so two payments with the same time never swap places between pages.
      .orderBy("p.occurredAt", "DESC")
      .addOrderBy("p.id", "DESC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    if (query.status) {
      builder.andWhere("p.status = :status", { status: query.status });
    }
    if (query.source) {
      builder.andWhere("p.source = :source", { source: query.source });
    }
    if (query.driverId) {
      builder.andWhere("p.driverId = :driverId", { driverId: query.driverId });
    }
    // The day the money was paid (B82).
    addDateRange(builder, "p.occurredAt", query);
    if (query.match === "assigned") {
      builder.andWhere("p.driverId IS NOT NULL");
    }
    if (query.match === "review") {
      // Looked at by matching and not placed. Payments not looked at yet are left out: they are seconds old.
      builder.andWhere("p.driverId IS NULL AND p.matchAttemptedAt IS NOT NULL");
    }
    if (query.search) {
      builder.andWhere(
        new Brackets((match) => {
          match
            .where("p.sender_name ILIKE :pattern")
            .orWhere("p.sender_handle ILIKE :pattern")
            .orWhere(
              "(driver.first_name || ' ' || driver.last_name) ILIKE :pattern",
            );
        }),
        { pattern: likePattern(query.search) },
      );
    }
    const [rows, total] = await builder.getManyAndCount();
    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Assigns (or re-assigns) a payment to a driver by hand (spec 6.2): method `manual`, who did it, and the
   * status `confirmed` (one stage for every method, B56). The payer's name is saved as the driver's
   * alias so the next payment from them matches by itself, unless that alias already belongs to another
   * driver: it is then left alone and reported back (one alias, one driver; the admin decides).
   * The ledger credit follows the payment in the same transaction (D60).
   *
   * @throws NotFoundException unknown payment.
   * @throws BadRequestException unknown driver.
   * @throws ConflictException the payment is rejected or in discrepancy.
   */
  assign(
    paymentId: string,
    driverId: string,
    adminId: string,
  ): Promise<AssignPaymentResultDto> {
    return this.dataSource.transaction(async (manager) => {
      // Locked until the end of the transaction, so matching or a second admin cannot change it meanwhile.
      const payment = await manager.findOne(Payment, {
        where: { id: paymentId },
        lock: { mode: "pessimistic_write" },
      });
      if (!payment) throw new NotFoundException("Payment not found.");
      if (!ASSIGNABLE.includes(payment.status)) {
        throw new ConflictException(
          `A ${payment.status} payment cannot be assigned.`,
        );
      }
      const driver = await manager.findOneBy(Driver, { id: driverId });
      if (!driver) throw new BadRequestException("Driver not found.");

      await manager.update(Payment, payment.id, {
        driverId,
        suggestedDriverId: null,
        matchMethod: MatchMethod.manual,
        matchConfidence: null,
        matchExplanation: "Assigned by an admin",
        matchedById: adminId,
        matchAttemptedAt: new Date(),
        status: PaymentStatus.confirmed,
      });
      // Same transaction: the payment and its ledger credit change together or not at all. A reassignment
      // reverses the old driver's credit and credits the new one (D60).
      await this.ledger.syncPaymentCredit(manager, payment.id, adminId);

      let aliasSaved = false;
      let aliasOwnedBy: PaymentDriverDto | null = null;
      const type = ALIAS_TYPE_BY_SOURCE[payment.source];
      if (type) {
        const valueNormalized = normalizeAliasValue(type, payment.senderName);
        const existing = await manager.findOne(PaymentAlias, {
          where: { type, valueNormalized },
          relations: { driver: true },
        });
        if (!existing) {
          await manager.insert(PaymentAlias, {
            driverId,
            type,
            value: payment.senderName,
            valueNormalized,
            source: AliasSource.manual,
          });
          aliasSaved = true;
        } else if (existing.driverId !== driverId && existing.driver) {
          aliasOwnedBy = this.toDriverDto(existing.driver);
        }
      }

      const updated = await manager.findOneOrFail(Payment, {
        where: { id: payment.id },
        relations: { driver: true, suggestedDriver: true },
      });
      return { payment: this.toDto(updated), aliasSaved, aliasOwnedBy };
    });
  }

  /**
   * Records a payment an admin received by hand (B79: cash, a check, a card in the office, or any method): a
   * `manual` payment, `confirmed` at once, credited to the driver's ledger in the same transaction, so it shows on
   * the Payments page like every other payment.
   *
   * Idempotent on `requestKey` (the payment's `externalId` is `manual:<requestKey>`; the unique
   * `(source, external_id)` in the database is the real guard): sending it again returns the payment already made.
   * A reference is unique among manual payments (a check recorded twice is refused).
   *
   * A payment of the same amount already on the driver within three Chicago days of the date is reported back as a
   * possible duplicate (a Zelle payment may already have arrived by email and been credited), unless the admin
   * confirms with `confirmDuplicate`.
   *
   * @throws BadRequestException unknown driver, or a date in the future or more than 90 days back.
   * @throws ConflictException possible duplicate (code `possible_duplicate`), the request key used for a different
   *   payment, or the reference used before.
   */
  async recordManual(
    input: RecordPaymentDto,
    adminId: string,
  ): Promise<PaymentDto> {
    assertRecentDay(input.paidOn, MAX_BACKDATE_DAYS);
    const externalId = `manual:${input.requestKey}`;
    const reference = input.reference ?? null;

    /** The payment this request already made, if any; refuses a key reused for something else. */
    const repeated = async (manager: EntityManager) => {
      const existing = await manager.findOne(Payment, {
        where: { source: PaymentSource.manual, externalId },
        relations: { driver: true, suggestedDriver: true },
      });
      if (!existing) return null;
      const same =
        existing.driverId === input.driverId &&
        existing.manualMethod === input.method &&
        existing.amountCents === input.amountCents &&
        existing.transactionId === reference &&
        existing.description === (input.description ?? null) &&
        existing.internalNote === (input.internalNote ?? null) &&
        chicagoDate(existing.occurredAt) === input.paidOn;
      if (!same) {
        throw new ConflictException(
          "This request key was already used for a different payment.",
        );
      }
      return this.toDto(existing);
    };

    try {
      return await this.dataSource.transaction(async (manager) => {
        const driver = await manager.findOneBy(Driver, {
          id: input.driverId,
        });
        if (!driver) throw new BadRequestException("Driver not found.");

        const again = await repeated(manager);
        if (again) return again;

        if (!input.confirmDuplicate) {
          // Not this request's own payment: a request sent twice at the same moment may find the copy the other
          // one just committed, and that is a repeat (answered below by the unique key), not a duplicate.
          const [duplicate] = (await manager.query(
            `SELECT id, source, manual_method AS "manualMethod", amount_cents AS "amountCents",
                    occurred_at AS "occurredAt"
             FROM payments
             WHERE driver_id = $1 AND status = 'confirmed' AND amount_cents = $2
               AND (occurred_at AT TIME ZONE 'America/Chicago')::date
                   BETWEEN $3::date - 3 AND $3::date + 3
               AND NOT (source = 'manual' AND external_id = $4)
             ORDER BY occurred_at DESC LIMIT 1`,
            [input.driverId, input.amountCents, input.paidOn, externalId],
          )) as Record<string, unknown>[];
          if (duplicate) {
            throw new ConflictException({
              statusCode: 409,
              error: "Conflict",
              message:
                "This driver already has a payment of the same amount within three days of this date.",
              code: "possible_duplicate",
              duplicate,
            });
          }
        }

        // Today: the real time. Another day: 18:00 UTC, which is noon or 1 PM that same day in Chicago.
        const occurredAt =
          input.paidOn === chicagoDate(new Date())
            ? new Date()
            : new Date(`${input.paidOn}T18:00:00Z`);
        const { identifiers } = await manager.insert(Payment, {
          source: PaymentSource.manual,
          manualMethod: input.method,
          externalId,
          transactionId: reference,
          description: input.description ?? null,
          internalNote: input.internalNote ?? null,
          amountCents: input.amountCents,
          senderName: `${driver.firstName} ${driver.lastName}`,
          senderHandle: null,
          occurredAt,
          extractionConfidence: null,
          status: PaymentStatus.confirmed,
          driverId: driver.id,
          suggestedDriverId: null,
          matchMethod: MatchMethod.manual,
          matchConfidence: null,
          matchExplanation: "Recorded by an admin",
          matchedById: adminId,
          matchAttemptedAt: new Date(),
        });
        const paymentId = (identifiers[0] as { id: string }).id;
        await this.ledger.syncPaymentCredit(manager, paymentId, adminId);

        return this.toDto(
          await manager.findOneOrFail(Payment, {
            where: { id: paymentId },
            relations: { driver: true, suggestedDriver: true },
          }),
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, "payments_source_transaction_id_key")) {
        throw new ConflictException(
          `A manual payment with reference ${reference} was already recorded.`,
        );
      }
      if (isUniqueViolation(error, "payments_source_external_id_key")) {
        // Two requests with the same key at the same moment: the other one won; answer with its payment.
        const winner = await repeated(this.dataSource.manager);
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * Voids a payment an admin recorded by hand (it bounced, or was recorded by mistake): the payment becomes
   * `rejected` and its ledger credit is reversed, in one transaction. Payments that came by email are not voided
   * here; they are reassigned on the Payments page.
   * @throws NotFoundException unknown payment.
   * @throws ConflictException not a manual payment, or not confirmed (already voided).
   */
  voidManual(
    paymentId: string,
    reason: string,
    adminId: string,
  ): Promise<PaymentDto> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: { id: paymentId },
        lock: { mode: "pessimistic_write" },
      });
      if (!payment) throw new NotFoundException("Payment not found.");
      if (payment.source !== PaymentSource.manual) {
        throw new ConflictException(
          "Only a payment recorded by hand can be voided. Reassign email payments on the Payments page.",
        );
      }
      if (payment.status !== PaymentStatus.confirmed) {
        throw new ConflictException("This payment was already voided.");
      }
      await manager.update(Payment, payment.id, {
        status: PaymentStatus.rejected,
        matchExplanation: `Voided by an admin: ${reason}`,
      });
      await this.ledger.syncPaymentCredit(manager, payment.id, adminId, reason);
      return this.toDto(
        await manager.findOneOrFail(Payment, {
          where: { id: payment.id },
          relations: { driver: true, suggestedDriver: true },
        }),
      );
    });
  }

  /** Copies the response fields from the entity, field by field. */
  private toDto(payment: Payment): PaymentDto {
    return {
      id: payment.id,
      source: payment.source,
      status: payment.status,
      manualMethod: payment.manualMethod,
      description: payment.description,
      internalNote: payment.internalNote,
      amountCents: payment.amountCents,
      senderName: payment.senderName,
      senderHandle: payment.senderHandle,
      transactionId: payment.transactionId,
      occurredAt: payment.occurredAt,
      extractionConfidence: payment.extractionConfidence,
      externalId: payment.externalId,
      driver: payment.driver ? this.toDriverDto(payment.driver) : null,
      suggestedDriver: payment.suggestedDriver
        ? this.toDriverDto(payment.suggestedDriver)
        : null,
      matchMethod: payment.matchMethod,
      matchConfidence: payment.matchConfidence,
      matchExplanation: payment.matchExplanation,
      createdAt: payment.createdAt,
    };
  }

  private toDriverDto(driver: Driver): PaymentDriverDto {
    return {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
    };
  }
}
