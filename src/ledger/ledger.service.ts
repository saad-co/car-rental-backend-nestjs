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
  LedgerDirection,
  LedgerEntry,
  LedgerEntryKind,
} from "./ledger-entry.entity.js";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto.js";
import {
  LedgerPageDto,
  LedgerPeriod,
  LedgerPeriodDto,
  LedgerSummaryDto,
  LedgerSummaryQueryDto,
} from "./dto/ledger-read.dto.js";
import {
  CreateLedgerEntryDto,
  LedgerEntryDto,
  MAX_BACKDATE_DAYS,
} from "./dto/ledger-entry.dto.js";

/** Most periods one summary request may cover (two years of weeks). */
const MAX_SUMMARY_PERIODS = 104;

/** SQL for an entry's signed amount: credits count up, debits down. */
const SIGNED = `CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END`;

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
 * The driver ledger (D60): writes entries and reads balances. Every write is append-only (the database trigger
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
   * @throws BadRequestException date in the future, more than 90 days back, or not a real day.
   * @throws ConflictException the key was already used for a different entry.
   */
  async addManualEntry(
    driverId: string,
    input: CreateLedgerEntryDto,
    adminId: string,
  ): Promise<LedgerEntryDto> {
    await this.assertDriverExists(driverId);
    const direction = input.direction;
    this.assertManualDate(input.effectiveDate);

    const values = {
      driverId,
      direction,
      amountCents: input.amountCents,
      kind: LedgerEntryKind.adjustment,
      description: input.reason,
      effectiveDate: input.effectiveDate,
      createdById: adminId,
      idempotencyKey: `manual:${input.requestKey}`,
    };

    // ON CONFLICT DO NOTHING on the key only: a repeat of the same request inserts nothing and raises no error,
    // while every other constraint still raises. Plain SQL: TypeORM's insert builder cannot limit ON CONFLICT to one
    // column. Values are parameters ($1…), never pasted into the SQL.
    const rows = (await this.dataSource.query(
      `INSERT INTO ledger_entries
         (driver_id, direction, amount_cents, kind, description, effective_date, created_by_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        values.driverId,
        values.direction,
        values.amountCents,
        values.kind,
        values.description,
        values.effectiveDate,
        values.createdById,
        values.idempotencyKey,
      ],
    )) as { id: string }[];
    const insertedId = rows[0]?.id;

    if (insertedId) return this.findDto(insertedId);

    // The key was used before: the same request repeated, or a different entry reusing the key.
    const existing = await this.dataSource
      .getRepository(LedgerEntry)
      .findOneByOrFail({ idempotencyKey: values.idempotencyKey });
    const same =
      existing.driverId === driverId &&
      existing.direction === direction &&
      existing.amountCents === input.amountCents &&
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
   * ledger existed (D60). Each payment in its own transaction with the payment row locked, through
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
   * One page of a driver's ledger, newest first, each row with the balance right after it. The running balance is
   * a window function over the driver's whole history in date order (so a backdated entry lands in the right place),
   * computed before the page is cut.
   *
   * Order in time: the day the entry belongs to, then when it was recorded. A reversal and the credit that replaces
   * it share one transaction (same `created_at`), so the reversal counts first; `id` keeps the order stable.
   * @throws NotFoundException unknown driver.
   */
  async listPage(
    driverId: string,
    query: PaginationQueryDto,
  ): Promise<LedgerPageDto> {
    await this.assertDriverExists(driverId);
    const rows = (await this.dataSource.query(
      `WITH history AS (
         SELECT e.*,
           SUM(${SIGNED}) OVER (
             ORDER BY effective_date, created_at, (kind = 'reversal') DESC, id
             ROWS UNBOUNDED PRECEDING)::bigint AS running
         FROM ledger_entries e WHERE e.driver_id = $1)
       SELECT h.id, h.driver_id, h.direction, h.amount_cents, h.kind, h.description,
              h.effective_date::text AS effective_date, h.payment_id, h.reversal_of_id, h.created_by_id,
              h.created_at, h.running, u.email AS created_by_email, r.id AS reversed_by_id
       FROM history h
       LEFT JOIN users u ON u.id = h.created_by_id
       LEFT JOIN ledger_entries r ON r.reversal_of_id = h.id
       ORDER BY h.effective_date DESC, h.created_at DESC, (h.kind = 'reversal') ASC, h.id DESC
       LIMIT $2 OFFSET $3`,
      [driverId, query.limit, (query.page - 1) * query.limit],
    )) as RawLedgerRow[];
    const [{ total, balance }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total, COALESCE(SUM(${SIGNED}), 0)::bigint AS balance
       FROM ledger_entries WHERE driver_id = $1`,
      [driverId],
    )) as [{ total: number; balance: string }];

    return {
      items: rows.map((row) =>
        Object.assign(
          this.toDto(
            {
              id: row.id,
              driverId: row.driver_id,
              direction: row.direction,
              amountCents: row.amount_cents,
              kind: row.kind,
              description: row.description,
              effectiveDate: row.effective_date,
              paymentId: row.payment_id,
              reversalOfId: row.reversal_of_id,
              createdById: row.created_by_id,
              createdBy: row.created_by_email
                ? ({ email: row.created_by_email } as LedgerEntry["createdBy"])
                : null,
              idempotencyKey: "",
              createdAt: row.created_at,
            },
            row.reversed_by_id,
          ),
          { runningBalanceCents: Number(row.running) },
        ),
      ),
      total,
      page: query.page,
      limit: query.limit,
      balanceCents: Number(balance),
    };
  }

  /**
   * A driver's ledger grouped by week (Monday to Sunday) or calendar month, newest first, empty periods included.
   * Grouping is by `effective_date`, a plain calendar day, cast to `timestamp` WITHOUT time zone before
   * `date_trunc`, so neither the server's time zone nor daylight saving can move a day into another period.
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException a date that is not a real day, `from` after `to`, or more than 104 periods.
   */
  async summary(
    driverId: string,
    query: LedgerSummaryQueryDto,
  ): Promise<LedgerSummaryDto> {
    await this.assertDriverExists(driverId);
    const to = query.to ?? chicagoDate(new Date());
    for (const day of [query.from, to]) {
      if (day !== undefined && !isCalendarDate(day)) {
        throw new BadRequestException(`${day} is not a real calendar day.`);
      }
    }
    if (query.from !== undefined && query.from > to) {
      throw new BadRequestException("from must not be after to.");
    }
    const unit = query.period === LedgerPeriod.week ? "week" : "month";

    // The periods to show: from the one containing `from` (default: 11 periods earlier) to the one containing `to`.
    const periods = (await this.dataSource.query(
      `SELECT gs::date::text AS start, (gs + $3::interval)::date::text AS next
       FROM generate_series(
         COALESCE(date_trunc($1, $2::date::timestamp), date_trunc($1, $4::date::timestamp) - 11 * $3::interval),
         date_trunc($1, $4::date::timestamp),
         $3::interval) gs
       ORDER BY gs`,
      [unit, query.from ?? null, `1 ${unit}`, to],
    )) as { start: string; next: string }[];
    if (periods.length > MAX_SUMMARY_PERIODS) {
      throw new BadRequestException(
        `At most ${MAX_SUMMARY_PERIODS} periods at a time.`,
      );
    }
    const first = periods[0].start;
    const after = periods[periods.length - 1].next;

    const [{ opening }] = (await this.dataSource.query(
      `SELECT COALESCE(SUM(${SIGNED}), 0)::bigint AS opening
       FROM ledger_entries WHERE driver_id = $1 AND effective_date < $2::date`,
      [driverId, first],
    )) as [{ opening: string }];
    const totals = (await this.dataSource.query(
      `SELECT date_trunc($2, effective_date::timestamp)::date::text AS start,
         COALESCE(SUM(amount_cents) FILTER (WHERE kind IN ('rent', 'adjustment') AND direction = 'debit'), 0)::bigint AS charges,
         COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'payment'), 0)::bigint AS payments,
         COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'adjustment' AND direction = 'credit'), 0)::bigint AS credits,
         COALESCE(SUM(${SIGNED}) FILTER (WHERE kind = 'reversal'), 0)::bigint AS reversals,
         COUNT(*)::int AS entries
       FROM ledger_entries
       WHERE driver_id = $1 AND effective_date >= $3::date AND effective_date < $4::date
       GROUP BY 1`,
      [driverId, unit, first, after],
    )) as {
      start: string;
      charges: string;
      payments: string;
      credits: string;
      reversals: string;
      entries: number;
    }[];
    const byStart = new Map(totals.map((t) => [t.start, t]));

    // Oldest to newest, chaining each closing balance into the next opening; then newest first for the screen.
    let balance = Number(opening);
    const items: LedgerPeriodDto[] = periods.map(({ start, next }) => {
      const t = byStart.get(start);
      const charges = Number(t?.charges ?? 0);
      const payments = Number(t?.payments ?? 0);
      const credits = Number(t?.credits ?? 0);
      const reversals = Number(t?.reversals ?? 0);
      const openingCents = balance;
      balance = openingCents + payments + credits - charges + reversals;
      return {
        start,
        end: addDays(next, -1),
        openingCents,
        chargesCents: charges,
        paymentsCents: payments,
        creditsCents: credits,
        reversalsCents: reversals,
        closingCents: balance,
        entryCount: t?.entries ?? 0,
      };
    });
    return { period: query.period, items: items.reverse() };
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

/** A row of `listPage`'s query, as Postgres returns it (snake_case columns, bigint as string). */
interface RawLedgerRow {
  id: string;
  driver_id: string;
  direction: LedgerDirection;
  amount_cents: number;
  kind: LedgerEntryKind;
  description: string;
  effective_date: string;
  payment_id: string | null;
  reversal_of_id: string | null;
  created_by_id: string | null;
  created_by_email: string | null;
  reversed_by_id: string | null;
  created_at: Date;
  running: string;
}
