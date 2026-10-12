import { Inject, Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { Payment, PaymentStatus } from "../payments/payment.entity.js";
import { InboundEmail, InboundEmailStatus } from "./inbound-email.entity.js";
import { LlmRateLimitError } from "./llm-client.js";
import type { MailboxMessage, MailboxReader } from "./mailbox-reader.js";
import type { PaymentExtractor } from "./payment-extraction.js";
import { EmailProcessor, type ProcessedEmail } from "./process-email.js";
import { ALLOWED_SENDERS } from "./sender-provider.js";

/** Everything the intake needs from outside. Null when intake is switched off (no IMAP or LLM settings). */
export interface EmailIntakeDeps {
  mailbox: MailboxReader;
  extractor: PaymentExtractor;
  /** Host name of the mail server whose `Authentication-Results` we trust (`mx.google.com`). */
  trustedServerId: string;
  /** The go-live point (B33): with nothing stored yet, only UIDs above this are read. */
  startAfterUid: number | null;
}

/** Injection token for `EmailIntakeDeps` (an interface has no runtime value to inject by). */
export const EMAIL_INTAKE_DEPS = Symbol("EMAIL_INTAKE_DEPS");

/** What one run did. */
export type SyncResult =
  { ran: false; reason: string } | { ran: true; stored: number };

/**
 * Key of the Postgres advisory lock that lets only one run work at a time. Any fixed number works; it
 * just has to be the same in every server instance and unused by other jobs.
 */
const SYNC_LOCK_KEY = 3_000_001;

/** After this many runs in a row where the AI failed on the same email, it is recorded as failed (D40). */
const MAX_ATTEMPTS = 3;

/**
 * Reads new payment emails and stores what they are (spec 5.1, D40). `syncNewMessages()` is the ONLY
 * code that reads the mailbox; the schedule (and later a "Sync now" button) only call it.
 */
@Injectable()
export class EmailIntakeService {
  private readonly logger = new Logger(EmailIntakeService.name);

  /**
   * How many runs in a row the AI failed on an email, by Gmail id. In memory: a restart resets it, which
   * only means a few extra retries.
   */
  private readonly failedAttempts = new Map<string, number>();

  /** Turns a raw email into what to store; null when intake is switched off. */
  private readonly processor: EmailProcessor | null;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(EMAIL_INTAKE_DEPS) private readonly deps: EmailIntakeDeps | null,
  ) {
    this.processor = deps
      ? new EmailProcessor({
          trustedServerId: deps.trustedServerId,
          extractor: deps.extractor,
        })
      : null;
  }

  /**
   * One run: take the lock, read every new allow-listed email oldest first, store each one with its
   * outcome. Emails are stored one by one, so a run that stops halfway keeps what it finished.
   *
   * Stops (throws) at the first temporary problem (mailbox, AI or database down) WITHOUT skipping that
   * email: the cursor is the highest stored UID, so skipping one would lose it forever. The next run
   * starts again from the same email.
   */
  async syncNewMessages(): Promise<SyncResult> {
    if (this.deps === null) {
      return { ran: false, reason: "email intake is switched off" };
    }
    const deps = this.deps;

    // An advisory lock belongs to one database connection, so take, use and release it on the same one.
    const lockConnection = this.dataSource.createQueryRunner();
    await lockConnection.connect();
    try {
      const [{ locked }] = (await lockConnection.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [SYNC_LOCK_KEY],
      )) as [{ locked: boolean }];
      if (!locked) {
        return { ran: false, reason: "another run is still working" };
      }
      try {
        return { ran: true, stored: await this.readNewEmails(deps) };
      } finally {
        await lockConnection.query("SELECT pg_advisory_unlock($1)", [
          SYNC_LOCK_KEY,
        ]);
      }
    } finally {
      await lockConnection.release();
    }
  }

  /** The work done while holding the lock. Returns how many emails were stored. */
  private async readNewEmails(deps: EmailIntakeDeps): Promise<number> {
    const { mailbox } = deps;
    return mailbox.withInbox(async (session) => {
      const cursor = await this.cursor(
        mailbox.mailbox,
        session.uidValidity,
        deps.startAfterUid,
      );
      const uids = await session.newUids(cursor, ALLOWED_SENDERS);

      let stored = 0;
      for (const uid of uids) {
        const message = await session.fetch(uid);
        if (await this.alreadyStored(mailbox.mailbox, message.gmailMessageId)) {
          // Same email under a new UID (Gmail reset UIDVALIDITY): never store it twice.
          this.logger.warn(
            `UID ${uid}: Gmail id ${message.gmailMessageId} is already stored, skipped`,
          );
          continue;
        }
        const processed = await this.process(message);
        const status = await this.save(
          mailbox.mailbox,
          session.uidValidity,
          message,
          processed,
        );
        this.logger.log(`UID ${uid}: ${status}`);
        stored++;
      }
      return stored;
    });
  }

  /**
   * Where to continue: the highest UID stored for this mailbox and UIDVALIDITY. With nothing stored, the
   * go-live point. Refuses to guess in the two cases where guessing could reprocess or skip mail.
   */
  private async cursor(
    mailbox: string,
    uidValidity: number,
    startAfterUid: number | null,
  ): Promise<number> {
    const repo = this.dataSource.getRepository(InboundEmail);
    const row = await repo
      .createQueryBuilder("email")
      .select("MAX(email.imapUid)", "max")
      .where("email.mailbox = :mailbox", { mailbox })
      .andWhere("email.imapUidValidity = :uidValidity", { uidValidity })
      .getRawOne<{ max: string | null }>();
    if (row?.max) return Number(row.max);

    if (await repo.existsBy({ mailbox })) {
      throw new Error(
        `UIDVALIDITY of ${mailbox} changed to ${uidValidity}: every UID has a new meaning. ` +
          "Intake stopped; a human must choose the new start point.",
      );
    }
    if (startAfterUid === null) {
      throw new Error(
        "IMAP_START_AFTER_UID is not set and no email is stored yet: set the go-live point (B33).",
      );
    }
    return startAfterUid;
  }

  private alreadyStored(mailbox: string, gmailMessageId: string) {
    return this.dataSource
      .getRepository(InboundEmail)
      .existsBy({ mailbox, gmailMessageId });
  }

  /**
   * Runs `EmailProcessor.process`. If the AI fails, the error is re-thrown to stop the run (retry next time),
   * until the same email has failed MAX_ATTEMPTS runs in a row; then it is recorded as failed.
   * A rate limit never counts toward that: the email waits until the AI answers again.
   */
  private async process(message: MailboxMessage): Promise<ProcessedEmail> {
    const processor = this.processor;
    if (!processor) throw new Error("Email intake is switched off.");
    const key = message.gmailMessageId;
    try {
      const result = await processor.process(message.raw, message.receivedAt);
      this.failedAttempts.delete(key);
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof LlmRateLimitError) {
        // Not this email's fault: wait for the limit to reset, in order, without a strike (B49).
        throw new Error(
          `UID ${message.uid}: AI rate-limited, retried next run (not counted): ${reason}`,
          { cause: error },
        );
      }
      const attempts = (this.failedAttempts.get(key) ?? 0) + 1;
      if (attempts < MAX_ATTEMPTS) {
        this.failedAttempts.set(key, attempts);
        throw new Error(
          `UID ${message.uid}: AI failed (attempt ${attempts} of ${MAX_ATTEMPTS}), retried next run: ${reason}`,
          { cause: error },
        );
      }
      this.failedAttempts.delete(key);
      return processor.process(message.raw, message.receivedAt, {
        abandonReason: `AI failed ${MAX_ATTEMPTS} runs in a row: ${reason}`,
      });
    }
  }

  /**
   * Stores one email (and its payment) in ONE transaction: both or neither. If the payment's transaction
   * id is already stored, the email is recorded as `duplicate_payment` and no second payment is made.
   * The unique keys back this up if anything slips past the check. Returns the status that was stored.
   */
  private save(
    mailbox: string,
    uidValidity: number,
    message: MailboxMessage,
    processed: ProcessedEmail,
  ): Promise<InboundEmailStatus> {
    return this.dataSource.transaction(async (manager) => {
      const { payment } = processed;
      const duplicateOf = payment?.transactionId
        ? await manager.findOneBy(Payment, {
            source: payment.source,
            transactionId: payment.transactionId,
          })
        : null;

      const values = {
        ...processed.email,
        ...(duplicateOf && {
          status: InboundEmailStatus.duplicate_payment,
          statusReason: `Same transaction ${duplicateOf.transactionId} as payment ${duplicateOf.id}`,
        }),
        mailbox,
        imapUidValidity: uidValidity,
        imapUid: message.uid,
        gmailMessageId: message.gmailMessageId,
      };
      const email = await this.insertEmail(manager, values);

      if (payment && !duplicateOf) {
        await manager.insert(Payment, {
          ...payment,
          externalId: email.id,
          status: PaymentStatus.unmatched,
        });
      }
      return values.status;
    });
  }

  private async insertEmail(
    manager: EntityManager,
    values: Omit<InboundEmail, "id" | "createdAt">,
  ): Promise<{ id: string }> {
    const result = await manager.insert(InboundEmail, values);
    return result.identifiers[0] as { id: string };
  }
}
