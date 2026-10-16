import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import {
  addDays,
  chicagoDate,
  isCalendarDate,
} from "../common/chicago-date.js";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { Driver } from "../drivers/driver.entity.js";
import {
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../payments/payment.entity.js";
import {
  CHARGE_CATEGORIES,
  LedgerCategory,
  LedgerDirection,
  LedgerEntry,
  LedgerEntryKind,
} from "./ledger-entry.entity.js";
import {
  CreateLedgerEntryDto,
  LedgerEntryDto,
  MAX_BACKDATE_DAYS,
} from "./dto/ledger-entry.dto.js";

/** The partial unique index that allows one opening balance per driver (see the entity). */
const ONE_OPENING_BALANCE = "ledger_entries_one_opening_balance_key";

/** How each payment source is named in a credit's description. */
const SOURCE_LABEL: Record<PaymentSource, string> = {
  [PaymentSource.email_zelle]: "Zelle",
  [PaymentSource.email_cashapp]: "Cash App",
  [PaymentSource.email_venmo]: "Venmo",
  [PaymentSource.email_stripe]: "Stripe",
  [PaymentSource.email_chime]: "Chime",
  [PaymentSource.plaid_zelle]: "Zelle (bank)",
  [PaymentSource.manual]: "Manual",
};

/**
 * The driver ledger (D58): writes entries and reads balances. Every write is append-only (the database trigger
 * refuses UPDATE and DELETE) and idempotent (a unique `idempotency_key`).
 *
 * Express comparison: this is the "model layer" you would call from a route handler; Nest creates one instance and
 * injects it wherever it is listed in a constructor (dependency injection instead of `require`).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Adds a charge or credit entered by an admin. Sending the same `requestKey` again returns the entry already
   * made (a double click makes one entry); the same key with different details is refused.
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException date in the future, more than 90 days back, not a real day, or a wrong direction.
   * @throws ConflictException the driver already has an opening balance, or the key was used for something else.
   */
  async addManualEntry(
    driverId: string,
    input: CreateLedgerEntryDto,
    adminId: string,
  ): Promise<LedgerEntryDto> {
    await this.assertDriverExists(driverId);
    const direction = this.directionFor(input.category, input.direction);
    this.assertManualDate(input.effectiveDate);

    const values = {
      driverId,
      direction,
      amountCents: input.amountCents,
      kind: LedgerEntryKind.adjustment,
      category: input.category,
      description: input.reason,
      effectiveDate: input.effectiveDate,
      createdById: adminId,
      idempotencyKey: `manual:${input.requestKey}`,
    };

    let insertedId: string | undefined;
    try {
      // ON CONFLICT DO NOTHING on the key only: a repeat of the same request inserts nothing and no error, while
      // every other constraint (e.g. a second opening balance) still raises.
      // Plain SQL: TypeORM's insert builder cannot limit ON CONFLICT to one column. Values are parameters ($1…).
      const rows = (await this.dataSource.query(
        `INSERT INTO ledger_entries
           (driver_id, direction, amount_cents, kind, category, description, effective_date, created_by_id,
            idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          values.driverId,
          values.direction,
          values.amountCents,
          values.kind,
          values.category,
          values.description,
          values.effectiveDate,
          values.createdById,
          values.idempotencyKey,
        ],
      )) as { id: string }[];
      insertedId = rows[0]?.id;
    } catch (error) {
      // A reversed opening balance still counts (the row stays): fix the amount with another entry instead.
      if (isUniqueViolation(error, ONE_OPENING_BALANCE)) {
        throw new ConflictException(
          "This driver already has an opening balance. Correct it with a charge or credit entry.",
        );
      }
      throw error;
    }

    if (insertedId) return this.findDto(insertedId);

    // The key was used before: the same request repeated, or a different entry reusing the key.
    const existing = await this.dataSource
      .getRepository(LedgerEntry)
      .findOneByOrFail({ idempotencyKey: values.idempotencyKey });
    const same =
      existing.driverId === driverId &&
      existing.direction === direction &&
      existing.amountCents === input.amountCents &&
      existing.category === input.category &&
      existing.effectiveDate === input.effectiveDate &&
      existing.description === input.reason;
    if (!same) {
      throw new ConflictException(
        "This request key was already used for a different entry.",
      );
    }
    return this.findDto(existing.id);
  }

  /**
   * Cancels an entry with a reversal: same amount, opposite direction, dated today (Chicago), so past weeks are not
   * changed by a correction. Payment credits are refused here: they change only through the payment (reassign), so
   * the payment and the ledger can never disagree.
   * @throws NotFoundException no such entry on this driver.
   * @throws ConflictException a reversal, a payment credit, or reversed already.
   */
  async reverse(
    driverId: string,
    entryId: string,
    reason: string,
    adminId: string,
  ): Promise<LedgerEntryDto> {
    const reversalId = await this.dataSource.transaction(async (manager) => {
      // The row lock makes a second admin reversing the same entry wait, then see the first reversal.
      const original = await manager.findOne(LedgerEntry, {
        where: { id: entryId, driverId },
        lock: { mode: "pessimistic_write" },
      });
      if (!original) throw new NotFoundException("Ledger entry not found.");
      if (original.kind === LedgerEntryKind.payment) {
        throw new ConflictException(
          "A payment cannot be reversed from the ledger. Reassign the payment instead.",
        );
      }
      return (
        await this.reverseEntry(
          manager,
          original,
          `Reversal: ${reason}`,
          adminId,
        )
      ).id;
    });
    return this.findDto(reversalId);
  }

  /**
   * Writes the reversal of `original` inside the caller's transaction. Used by `reverse` and by payment
   * reassignment. The caller must hold a lock on `original`.
   * @throws ConflictException `original` is a reversal or is reversed already.
   */
  async reverseEntry(
    manager: EntityManager,
    original: LedgerEntry,
    description: string,
    createdById: string | null,
  ): Promise<LedgerEntry> {
    if (original.kind === LedgerEntryKind.reversal) {
      throw new ConflictException("A reversal cannot be reversed.");
    }
    if (await manager.existsBy(LedgerEntry, { reversalOfId: original.id })) {
      throw new ConflictException("This entry is already reversed.");
    }
    try {
      return await manager.save(
        manager.create(LedgerEntry, {
          driverId: original.driverId,
          direction:
            original.direction === LedgerDirection.debit
              ? LedgerDirection.credit
              : LedgerDirection.debit,
          amountCents: original.amountCents,
          kind: LedgerEntryKind.reversal,
          category: null,
          description,
          effectiveDate: chicagoDate(new Date()),
          paymentId: original.paymentId,
          reversalOfId: original.id,
          createdById,
          idempotencyKey: `reversal:${original.id}`,
        }),
      );
    } catch (error) {
      // Last line of defence if two reversals raced without the lock: `reversal_of_id` is unique.
      if (isUniqueViolation(error)) {
        throw new ConflictException("This entry is already reversed.");
      }
      throw error;
    }
  }

  /**
   * Makes the ledger agree with a payment, inside the caller's transaction (which must hold a lock on the payment
   * row, so two writers for one payment run one after the other). The rule: a `confirmed` payment with a driver has
   * exactly one active (not reversed) credit, on that driver; any other payment has none.
   * - no credit yet → credit the driver;
   * - credit on another driver (reassignment) → reverse it, credit the new driver;
   * - credit on the same driver → nothing (a retry or a repeated assign changes nothing).
   *
   * Keys: the first credit is `payment:<id>`; a later one `payment:<id>:after:<previous credit id>`, so each credit
   * of a payment has its own unique key and a retry of the same step can never write it twice.
   *
   * @param createdById the admin who caused it, or null for the system (matching, backfill).
   */
  async syncPaymentCredit(
    manager: EntityManager,
    paymentId: string,
    createdById: string | null,
  ): Promise<void> {
    const payment = await manager.findOneByOrFail(Payment, { id: paymentId });
    const credits = await manager.find(LedgerEntry, {
      where: { paymentId, kind: LedgerEntryKind.payment },
      order: { createdAt: "DESC", id: "DESC" },
    });
    const reversedIds = new Set(
      (
        await manager.find(LedgerEntry, {
          where: { paymentId, kind: LedgerEntryKind.reversal },
        })
      ).map((r) => r.reversalOfId),
    );
    const active = credits.find((c) => !reversedIds.has(c.id)) ?? null;

    const wanted =
      payment.status === PaymentStatus.confirmed && payment.driverId !== null
        ? payment.driverId
        : null;
    if (
      active &&
      active.driverId === wanted &&
      active.amountCents === payment.amountCents
    ) {
      return;
    }
    if (active) {
      await this.reverseEntry(
        manager,
        active,
        wanted
          ? "Payment moved to another driver"
          : "Payment no longer confirmed",
        createdById,
      );
    }
    if (!wanted) return;

    const latest = credits[0];
    await manager.insert(LedgerEntry, {
      driverId: wanted,
      direction: LedgerDirection.credit,
      amountCents: payment.amountCents,
      kind: LedgerEntryKind.payment,
      category: null,
      description:
        `${SOURCE_LABEL[payment.source]} payment from ${payment.senderName}`.slice(
          0,
          500,
        ),
      effectiveDate: chicagoDate(payment.occurredAt),
      paymentId,
      reversalOfId: null,
      createdById,
      idempotencyKey: latest
        ? `payment:${paymentId}:after:${latest.id}`
        : `payment:${paymentId}`,
    });
  }

  /**
   * Credits every `confirmed` payment that has no active credit on its driver: the payments confirmed before the
   * ledger existed (D58). Each payment in its own transaction with the payment row locked, through
   * `syncPaymentCredit`, so running it twice, or while matching runs, never credits twice.
   *
   * @param apply false = dry run: count only, write nothing.
   * @returns how many payments needed a credit, and how many were credited.
   */
  async backfillPaymentCredits(
    apply: boolean,
  ): Promise<{ missing: number; credited: number }> {
    const rows = (await this.dataSource.query(
      `SELECT p.id FROM payments p
       WHERE p.status = 'confirmed' AND p.driver_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ledger_entries e
           WHERE e.payment_id = p.id AND e.kind = 'payment' AND e.driver_id = p.driver_id
             AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of_id = e.id))
       ORDER BY p.occurred_at, p.id`,
    )) as { id: string }[];
    if (!apply) return { missing: rows.length, credited: 0 };

    let credited = 0;
    for (const { id } of rows) {
      await this.dataSource.transaction(async (manager) => {
        await manager.findOne(Payment, {
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
        await this.syncPaymentCredit(manager, id, null);
      });
      credited++;
    }
    return { missing: rows.length, credited };
  }

  /**
   * The driver's balance in cents: credits minus debits. Negative means the driver owes money. Summed by Postgres
   * over integers, never in JavaScript floats.
   */
  async balanceCents(
    driverId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<number> {
    const row = await manager
      .createQueryBuilder(LedgerEntry, "e")
      .select(
        `COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END), 0)::bigint`,
        "balance",
      )
      .where("e.driver_id = :driverId", { driverId })
      .getRawOne<{ balance: string }>();
    return Number(row?.balance ?? 0);
  }

  /** One entry with who made it and whether it was reversed, as the API returns it. */
  async findDto(id: string): Promise<LedgerEntryDto> {
    const entry = await this.dataSource
      .getRepository(LedgerEntry)
      .findOneOrFail({
        where: { id },
        relations: { createdBy: true },
      });
    const reversal = await this.dataSource
      .getRepository(LedgerEntry)
      .findOneBy({ reversalOfId: id });
    return this.toDto(entry, reversal?.id ?? null);
  }

  /** Copies the response fields one by one, so nothing else (e.g. the admin's password hash) can leak out. */
  toDto(entry: LedgerEntry, reversedById: string | null): LedgerEntryDto {
    return {
      id: entry.id,
      driverId: entry.driverId,
      direction: entry.direction,
      amountCents: entry.amountCents,
      kind: entry.kind,
      category: entry.category,
      description: entry.description,
      effectiveDate: entry.effectiveDate,
      paymentId: entry.paymentId,
      reversalOfId: entry.reversalOfId,
      reversedById,
      canReverse:
        reversedById === null &&
        entry.kind !== LedgerEntryKind.reversal &&
        entry.kind !== LedgerEntryKind.payment,
      createdById: entry.createdById,
      createdByEmail: entry.createdBy?.email ?? null,
      createdAt: entry.createdAt,
    };
  }

  /**
   * The direction of a manual entry: fixed by the category, chosen by the admin only for an opening balance.
   * @throws BadRequestException a direction sent for another category, or missing for an opening balance.
   */
  private directionFor(
    category: LedgerCategory,
    requested: LedgerDirection | undefined,
  ): LedgerDirection {
    if (category === LedgerCategory.opening_balance) {
      if (!requested) {
        throw new BadRequestException(
          "Say whether the opening balance is owed (debit) or in credit (credit).",
        );
      }
      return requested;
    }
    if (requested) {
      throw new BadRequestException(
        "The direction is set by the category; leave it out.",
      );
    }
    return CHARGE_CATEGORIES.includes(category)
      ? LedgerDirection.debit
      : LedgerDirection.credit;
  }

  /**
   * A manual entry is dated today or up to 90 days back, in Chicago. Never in the future.
   * @throws BadRequestException otherwise.
   */
  private assertManualDate(day: string): void {
    if (!isCalendarDate(day)) {
      throw new BadRequestException("The date is not a real calendar day.");
    }
    const today = chicagoDate(new Date());
    if (day > today) {
      throw new BadRequestException("The date cannot be in the future.");
    }
    if (day < addDays(today, -MAX_BACKDATE_DAYS)) {
      throw new BadRequestException(
        `The date can be at most ${MAX_BACKDATE_DAYS} days back.`,
      );
    }
  }

  private async assertDriverExists(id: string): Promise<void> {
    if (!(await this.dataSource.getRepository(Driver).existsBy({ id }))) {
      throw new NotFoundException("Driver not found.");
    }
  }
}
