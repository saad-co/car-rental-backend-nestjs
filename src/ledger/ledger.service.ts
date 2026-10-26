import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, FindOptionsWhere, In } from "typeorm";
import {
  addDays,
  chicagoDate,
  isCalendarDate,
} from "../common/chicago-date.js";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { Driver } from "../drivers/driver.entity.js";
import {
  Payment,
  PaymentManualMethod,
  PaymentSource,
  PaymentStatus,
} from "../payments/payment.entity.js";
import {
  CHARGE_KINDS_SQL,
  isCharge,
  LedgerDirection,
  LedgerEntry,
  LedgerEntryKind,
  MAX_DESCRIPTION_LENGTH,
} from "./ledger-entry.entity.js";
import { formatCents, parseAmountToCents } from "../common/money.js";
import { assertRecentDay } from "../common/recent-day.js";
import { likePattern } from "../common/search.js";
import { ageBalance } from "./aging.js";
import {
  LedgerAppliedCreditDto,
  LedgerEntryDetailsDto,
  LedgerEntryLinkDto,
  LedgerListQueryDto,
  LedgerOrder,
  LedgerOverviewDto,
  LedgerPageDto,
  LedgerPeriod,
  LedgerPeriodDto,
  LedgerRowDto,
  LedgerSummaryDto,
  LedgerSummaryQueryDto,
  LedgerTypeFilter,
} from "./dto/ledger-read.dto.js";
import { ledgerRef, parseLedgerRef } from "./ledger-ref.js";
import {
  CreateLedgerEntryDto,
  LedgerEntryDto,
  MAX_BACKDATE_DAYS,
} from "./dto/ledger-entry.dto.js";

/** One debit for `postSystemDebits`: `key` is the unique idempotency key, `effectiveDate` a Chicago day `YYYY-MM-DD`. */
export interface SystemDebitInput {
  key: string;
  amountCents: number;
  kind: LedgerEntryKind;
  description: string;
  effectiveDate: string;
}

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

/** How a payment recorded by hand is named in its credit's description. */
const MANUAL_METHOD_LABEL: Record<PaymentManualMethod, string> = {
  [PaymentManualMethod.zelle]: "Zelle",
  [PaymentManualMethod.cash_app]: "Cash App",
  [PaymentManualMethod.venmo]: "Venmo",
  [PaymentManualMethod.stripe]: "Stripe",
  [PaymentManualMethod.chime]: "Chime",
  [PaymentManualMethod.cash]: "Cash",
  [PaymentManualMethod.check]: "Check",
  [PaymentManualMethod.card]: "Card",
  [PaymentManualMethod.money_order]: "Money order",
  [PaymentManualMethod.other]: "Other",
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
    assertRecentDay(input.effectiveDate, MAX_BACKDATE_DAYS);
    const appliesToId = input.appliesToId ?? null;
    if (appliesToId && direction !== LedgerDirection.credit) {
      throw new BadRequestException(
        "Only a credit can be applied against a charge.",
      );
    }

    const values = {
      driverId,
      direction,
      amountCents: input.amountCents,
      kind: LedgerEntryKind.adjustment,
      description: input.reason,
      effectiveDate: input.effectiveDate,
      appliesToId,
      internalNote: input.internalNote ?? null,
      createdById: adminId,
      idempotencyKey: `manual:${input.requestKey}`,
    };

    const entryId = await this.dataSource.transaction(async (manager) => {
      // A credit against a charge locks the charge first: two admins crediting the same charge then run one after
      // the other, so together they can never credit more than the charge was.
      const charge = appliesToId
        ? await this.lockCharge(manager, driverId, appliesToId)
        : null;

      // A repeat of the same request (a double click, a retry): answer with the entry already made, without
      // checking the limit again (the first request may have used it all).
      const repeated = await manager.findOneBy(LedgerEntry, {
        idempotencyKey: values.idempotencyKey,
      });
      if (repeated) {
        const same =
          repeated.driverId === driverId &&
          repeated.direction === direction &&
          repeated.amountCents === input.amountCents &&
          repeated.effectiveDate === input.effectiveDate &&
          repeated.description === input.reason &&
          repeated.appliesToId === appliesToId &&
          repeated.internalNote === values.internalNote;
        if (!same) {
          throw new ConflictException(
            "This request key was already used for a different entry.",
          );
        }
        return repeated.id;
      }

      if (charge) {
        const left =
          charge.amountCents - (await this.appliedCents(manager, charge.id));
        if (input.amountCents > left) {
          throw new BadRequestException(
            `At most ${formatCents(left)} is left to credit on ${ledgerRef(charge.kind, charge.direction, charge.entryNo)}.`,
          );
        }
      }

      // ON CONFLICT DO NOTHING on the key only: if another request with this key slipped in between the check
      // above and here, this inserts nothing and raises no error (the key is unique in the database), and the
      // entry that won is read back below. Plain SQL: TypeORM's insert builder cannot limit ON CONFLICT to one
      // column. Values are parameters ($1…), never pasted into the SQL.
      const rows = (await manager.query(
        `INSERT INTO ledger_entries
           (driver_id, direction, amount_cents, kind, description, effective_date, applies_to_id, internal_note,
            created_by_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          values.driverId,
          values.direction,
          values.amountCents,
          values.kind,
          values.description,
          values.effectiveDate,
          values.appliesToId,
          values.internalNote,
          values.createdById,
          values.idempotencyKey,
        ],
      )) as { id: string }[];
      if (rows[0]) return rows[0].id;
      return (
        await manager.findOneByOrFail(LedgerEntry, {
          idempotencyKey: values.idempotencyKey,
        })
      ).id;
    });
    return this.findDto(entryId);
  }

  /**
   * Writes debits made by the system (no admin) inside the caller's transaction: the contract charges and rent of
   * Module 2 step 5 (D83). Each has a unique `key` (the ledger's idempotency key), and a key that is already in the
   * ledger is skipped, so signing and the rent job can both post the same due date and only one entry ever exists.
   * Plain SQL for the same reason as `addManualEntry`: `ON CONFLICT DO NOTHING` on the key only, values as parameters.
   *
   * @returns how many entries were written (the rest already existed).
   */
  async postSystemDebits(
    manager: EntityManager,
    driverId: string,
    debits: SystemDebitInput[],
  ): Promise<number> {
    if (debits.length === 0) return 0;
    const rows = (await manager.query(
      `INSERT INTO ledger_entries
         (driver_id, direction, amount_cents, kind, description, effective_date, created_by_id, idempotency_key)
       SELECT $1, 'debit', t.amount_cents, t.kind::ledger_entry_kind, t.description, t.effective_date::date, NULL, t.idempotency_key
       FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[])
         WITH ORDINALITY AS t(amount_cents, kind, description, effective_date, idempotency_key, position)
       ORDER BY t.position
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        driverId,
        debits.map((d) => d.amountCents),
        debits.map((d) => d.kind),
        debits.map((d) => d.description),
        debits.map((d) => d.effectiveDate),
        debits.map((d) => d.key),
      ],
    )) as { id: string }[];
    return rows.length;
  }

  /**
   * Locks a charge for a credit against it and checks it can take one: on this driver, a debit (rent or a manual
   * charge), not reversed.
   * @throws NotFoundException no such charge on this driver.
   * @throws BadRequestException not a charge, or reversed.
   */
  private async lockCharge(
    manager: EntityManager,
    driverId: string,
    chargeId: string,
  ): Promise<LedgerEntry> {
    const charge = await manager.findOne(LedgerEntry, {
      where: { id: chargeId, driverId },
      lock: { mode: "pessimistic_write" },
    });
    if (!charge) throw new NotFoundException("Charge not found.");
    if (!isCharge(charge)) {
      throw new BadRequestException("Only a charge can be credited against.");
    }
    if (await manager.existsBy(LedgerEntry, { reversalOfId: charge.id })) {
      throw new BadRequestException(
        `${ledgerRef(charge.kind, charge.direction, charge.entryNo)} was reversed.`,
      );
    }
    return charge;
  }

  /** The sum of the credits applied against a charge that were not reversed since. */
  private async appliedCents(
    manager: EntityManager,
    chargeId: string,
  ): Promise<number> {
    const [{ applied }] = (await manager.query(
      `SELECT COALESCE(SUM(c.amount_cents), 0)::bigint AS applied
       FROM ledger_entries c
       WHERE c.applies_to_id = $1
         AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of_id = c.id)`,
      [chargeId],
    )) as [{ applied: string }];
    return Number(applied);
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
      // Reversing a charge that has credits applied would give the driver the charge back and keep the credits:
      // the credits are reversed first.
      if (
        original.direction === LedgerDirection.debit &&
        (await this.appliedCents(manager, original.id)) > 0
      ) {
        throw new ConflictException(
          `Reverse the credits applied to ${ledgerRef(original.kind, original.direction, original.entryNo)} first.`,
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
   * @param voidReason when an admin voids a payment recorded by hand: why, written on the reversal.
   */
  async syncPaymentCredit(
    manager: EntityManager,
    paymentId: string,
    createdById: string | null,
    voidReason?: string,
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
          : voidReason
            ? `Payment voided: ${voidReason}`.slice(0, MAX_DESCRIPTION_LENGTH)
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
      description: this.paymentDescription(payment).slice(
        0,
        MAX_DESCRIPTION_LENGTH,
      ),
      effectiveDate: chicagoDate(payment.occurredAt),
      paymentId,
      reversalOfId: null,
      internalNote: payment.internalNote,
      createdById,
      idempotencyKey: latest
        ? `payment:${paymentId}:after:${latest.id}`
        : `payment:${paymentId}`,
    });
  }

  /**
   * What the payment's credit says: "Zelle payment from J. Smith", or for a payment an admin recorded
   * "Check payment · ref 1043".
   */
  private paymentDescription(payment: Payment): string {
    // The text an admin typed for a payment recorded by hand wins over the automatic one.
    if (payment.description) return payment.description;
    if (payment.source === PaymentSource.manual) {
      const method = payment.manualMethod
        ? MANUAL_METHOD_LABEL[payment.manualMethod]
        : "Manual";
      return `${method} payment${payment.transactionId ? ` · ref ${payment.transactionId}` : ""}`;
    }
    return `${SOURCE_LABEL[payment.source]} payment from ${payment.senderName}`;
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
   * One page of a driver's ledger, each row with the balance right after it. The running balance is a window function
   * over the driver's whole history in date order (so a backdated entry lands in the right place), computed before
   * the filters and the page are cut: a row's balance is the same whatever is filtered.
   *
   * Order in time: the day the entry belongs to, then when it was recorded. A reversal and the credit that replaces
   * it share one transaction (same `created_at`), so the reversal counts first; `id` keeps the order stable.
   * `order=asc` flips every part of that order.
   *
   * Filters (all optional, all in the database): the type of entry, the days the entries belong to (`from`, `to`,
   * plain calendar days), and a search: a reference like `CH-1042`, an amount like `85` or `$85.00` (the entries of
   * exactly that amount), or text in the description, the internal note or the email of the admin who entered it.
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException `from` after `to`.
   */
  async listPage(
    driverId: string,
    query: LedgerListQueryDto,
  ): Promise<LedgerPageDto> {
    await this.assertDriverExists(driverId);
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException(
        `The "from" date (${query.from}) is after the "to" date (${query.to}).`,
      );
    }
    const { where, params } = this.listFilters(driverId, query);
    const dir = query.order === LedgerOrder.asc ? "ASC" : "DESC";
    // The window's own order (see above) in the direction asked for; the reversal-first rule flips with it.
    const reversalFirst = query.order === LedgerOrder.asc ? "DESC" : "ASC";
    const limitAt = params.length + 1;

    const rows = (await this.dataSource.query(
      `WITH history AS (
         SELECT e.*,
           SUM(${SIGNED}) OVER (
             ORDER BY effective_date, created_at, (kind = 'reversal') DESC, id
             ROWS UNBOUNDED PRECEDING)::bigint AS running
         FROM ledger_entries e WHERE e.driver_id = $1)
       SELECT h.id, h.entry_no, h.driver_id, h.direction, h.amount_cents, h.kind, h.description,
              h.effective_date::text AS effective_date, h.payment_id, h.reversal_of_id, h.applies_to_id,
              h.internal_note, h.created_by_id, h.created_at, h.running, u.email AS created_by_email,
              r.id AS reversed_by_id, r.entry_no AS reversed_by_no,
              ro.entry_no AS reversal_of_no, ro.kind AS reversal_of_kind, ro.direction AS reversal_of_direction,
              a.entry_no AS applies_to_no, a.kind AS applies_to_kind, a.direction AS applies_to_direction,
              p.source AS payment_source, p.manual_method AS payment_manual_method, p.status AS payment_status,
              (SELECT COALESCE(SUM(c.amount_cents), 0) FROM ledger_entries c
                WHERE c.applies_to_id = h.id
                  AND NOT EXISTS (SELECT 1 FROM ledger_entries cr WHERE cr.reversal_of_id = c.id))::int AS applied_cents
       FROM history h
       LEFT JOIN users u ON u.id = h.created_by_id
       LEFT JOIN ledger_entries r ON r.reversal_of_id = h.id
       LEFT JOIN ledger_entries ro ON ro.id = h.reversal_of_id
       LEFT JOIN ledger_entries a ON a.id = h.applies_to_id
       LEFT JOIN payments p ON p.id = h.payment_id
       WHERE ${where}
       ORDER BY h.effective_date ${dir}, h.created_at ${dir}, (h.kind = 'reversal') ${reversalFirst}, h.id ${dir}
       LIMIT $${limitAt} OFFSET $${limitAt + 1}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    )) as RawLedgerRow[];

    const [{ total, debit, credit }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total,
         COALESCE(SUM(h.amount_cents) FILTER (WHERE h.direction = 'debit'), 0)::bigint AS debit,
         COALESCE(SUM(h.amount_cents) FILTER (WHERE h.direction = 'credit'), 0)::bigint AS credit
       FROM ledger_entries h
       LEFT JOIN users u ON u.id = h.created_by_id
       WHERE ${where}`,
      params,
    )) as [{ total: number; debit: string; credit: string }];

    const balanceCents = await this.balanceCents(driverId);
    let balanceBeforeCents: number | null = null;
    if (query.from) {
      const [{ before }] = (await this.dataSource.query(
        `SELECT COALESCE(SUM(${SIGNED}), 0)::bigint AS before
         FROM ledger_entries WHERE driver_id = $1 AND effective_date < $2::date`,
        [driverId, query.from],
      )) as [{ before: string }];
      balanceBeforeCents = Number(before);
    }

    return {
      items: rows.map((row) => this.toRowDto(row)),
      total,
      page: query.page,
      limit: query.limit,
      balanceCents,
      totals: { debitCents: Number(debit), creditCents: Number(credit) },
      balanceBeforeCents,
    };
  }

  /**
   * The WHERE for `listPage` on the table aliased `h` (joined to `users u`), with its parameters. `$1` is the
   * driver. Only the fixed fragments below are ever written into the SQL; every value from the request is a
   * parameter.
   */
  private listFilters(
    driverId: string,
    query: LedgerListQueryDto,
  ): { where: string; params: unknown[] } {
    const conditions = ["h.driver_id = $1"];
    const params: unknown[] = [driverId];
    const param = (value: unknown) => `$${params.push(value)}`;

    switch (query.type) {
      case LedgerTypeFilter.charges:
        conditions.push(
          `h.direction = 'debit' AND h.kind IN (${CHARGE_KINDS_SQL})`,
        );
        break;
      case LedgerTypeFilter.credits:
        conditions.push("h.kind = 'adjustment' AND h.direction = 'credit'");
        break;
      case LedgerTypeFilter.payments:
        conditions.push("h.kind = 'payment'");
        break;
      case LedgerTypeFilter.reversals:
        conditions.push("h.kind = 'reversal'");
        break;
    }
    if (query.from) {
      conditions.push(`h.effective_date >= ${param(query.from)}::date`);
    }
    if (query.to) {
      conditions.push(`h.effective_date <= ${param(query.to)}::date`);
    }
    if (query.search) {
      const entryNo = parseLedgerRef(query.search);
      if (entryNo !== null) {
        conditions.push(`h.entry_no = ${param(entryNo)}`);
      } else {
        const pattern = param(likePattern(query.search));
        const matches = [
          `h.description ILIKE ${pattern}`,
          `h.internal_note ILIKE ${pattern}`,
          `u.email ILIKE ${pattern}`,
        ];
        // An amount (`85`, `$85.00`) also finds the entries of exactly that amount, not "contains 85".
        const cents = parseAmountToCents(query.search);
        if (cents !== null) matches.push(`h.amount_cents = ${param(cents)}`);
        conditions.push(`(${matches.join(" OR ")})`);
      }
    }
    return { where: conditions.join(" AND "), params };
  }

  /** One row of `listPage`'s query as the API returns it. */
  private toRowDto(row: RawLedgerRow): LedgerRowDto {
    const reversed = row.reversed_by_id !== null;
    const charge = isCharge(row);
    const left = row.amount_cents - row.applied_cents;
    return {
      id: row.id,
      entryNo: Number(row.entry_no),
      ref: ledgerRef(row.kind, row.direction, Number(row.entry_no)),
      driverId: row.driver_id,
      direction: row.direction,
      amountCents: row.amount_cents,
      kind: row.kind,
      description: row.description,
      effectiveDate: row.effective_date,
      paymentId: row.payment_id,
      reversalOfId: row.reversal_of_id,
      appliesToId: row.applies_to_id,
      internalNote: row.internal_note,
      reversedById: row.reversed_by_id,
      canReverse: this.canReverse(row.kind, reversed),
      createdById: row.created_by_id,
      createdByEmail: row.created_by_email,
      createdAt: row.created_at,
      runningBalanceCents: Number(row.running),
      appliesToRef:
        row.applies_to_no === null
          ? null
          : ledgerRef(
              row.applies_to_kind as LedgerEntryKind,
              row.applies_to_direction as LedgerDirection,
              Number(row.applies_to_no),
            ),
      reversalOfRef:
        row.reversal_of_no === null
          ? null
          : ledgerRef(
              row.reversal_of_kind as LedgerEntryKind,
              row.reversal_of_direction as LedgerDirection,
              Number(row.reversal_of_no),
            ),
      reversedByRef:
        row.reversed_by_no === null
          ? null
          : ledgerRef(
              LedgerEntryKind.reversal,
              LedgerDirection.credit,
              Number(row.reversed_by_no),
            ),
      paymentSource: row.payment_source,
      paymentManualMethod: row.payment_manual_method,
      canVoidPayment:
        row.kind === LedgerEntryKind.payment &&
        !reversed &&
        row.payment_source === PaymentSource.manual &&
        row.payment_status === PaymentStatus.confirmed,
      creditableCents: charge && !reversed && left > 0 ? left : null,
    };
  }

  /**
   * The top of the ledger page: the balance, what is owed by age (first in, first out, see `ageBalance`) and the
   * newest confirmed payment. Reversed entries and their reversals are left out of the aging: together they are
   * zero.
   * @throws NotFoundException unknown driver.
   */
  async overview(driverId: string): Promise<LedgerOverviewDto> {
    await this.assertDriverExists(driverId);
    const today = chicagoDate(new Date());
    const entries = (await this.dataSource.query(
      `SELECT e.direction, e.amount_cents AS "amountCents", e.effective_date::text AS "effectiveDate"
       FROM ledger_entries e
       WHERE e.driver_id = $1 AND e.kind <> 'reversal'
         AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of_id = e.id)
       ORDER BY e.effective_date, e.created_at, e.entry_no`,
      [driverId],
    )) as Parameters<typeof ageBalance>[0];

    const last = await this.dataSource.getRepository(Payment).findOne({
      where: { driverId, status: PaymentStatus.confirmed },
      order: { occurredAt: "DESC", id: "DESC" },
    });
    return {
      balanceCents: await this.balanceCents(driverId),
      aging: ageBalance(entries, today),
      lastPayment: last && {
        amountCents: last.amountCents,
        source: last.source,
        manualMethod: last.manualMethod,
        occurredAt: last.occurredAt,
      },
      asOf: today,
    };
  }

  /**
   * One entry with everything that links to it: what it reverses or was reversed by, the charge it is applied
   * against, the credits applied against it, and its payment.
   * @throws NotFoundException no such entry on this driver.
   */
  async entryDetails(
    driverId: string,
    entryId: string,
  ): Promise<LedgerEntryDetailsDto> {
    const repo = this.dataSource.getRepository(LedgerEntry);
    const entry = await repo.findOne({
      where: { id: entryId, driverId },
      relations: { createdBy: true },
    });
    if (!entry) throw new NotFoundException("Ledger entry not found.");

    const link = (e: LedgerEntry): LedgerEntryLinkDto => ({
      id: e.id,
      ref: ledgerRef(e.kind, e.direction, e.entryNo),
      description: e.description,
      effectiveDate: e.effectiveDate,
      createdAt: e.createdAt,
      createdByEmail: e.createdBy?.email ?? null,
    });
    const load = (where: FindOptionsWhere<LedgerEntry>) =>
      repo.findOne({ where, relations: { createdBy: true } });

    const reversedBy = await load({ reversalOfId: entry.id });
    const reversalOf = entry.reversalOfId
      ? await load({ id: entry.reversalOfId })
      : null;
    const appliesTo = entry.appliesToId
      ? await load({ id: entry.appliesToId })
      : null;
    const applied = await repo.find({
      where: { appliesToId: entry.id },
      relations: { createdBy: true },
      order: { createdAt: "ASC", entryNo: "ASC" },
    });
    const reversedCredits = new Set(
      applied.length === 0
        ? []
        : (
            await repo.find({
              where: { reversalOfId: In(applied.map((c) => c.id)) },
            })
          ).map((r) => r.reversalOfId),
    );
    const appliedCredits: LedgerAppliedCreditDto[] = applied.map((c) =>
      Object.assign(link(c), {
        amountCents: c.amountCents,
        reversed: reversedCredits.has(c.id),
      }),
    );
    const payment = entry.paymentId
      ? await this.dataSource
          .getRepository(Payment)
          .findOneBy({ id: entry.paymentId })
      : null;

    const charge = isCharge(entry);
    const left =
      entry.amountCents -
      appliedCredits
        .filter((c) => !c.reversed)
        .reduce((sum, c) => sum + c.amountCents, 0);

    return {
      entry: this.toDto(entry, reversedBy?.id ?? null),
      reversalOf: reversalOf && link(reversalOf),
      reversedBy: reversedBy && link(reversedBy),
      appliesTo: appliesTo && link(appliesTo),
      appliedCredits,
      payment: payment && {
        id: payment.id,
        source: payment.source,
        manualMethod: payment.manualMethod,
        senderName: payment.senderName,
        transactionId: payment.transactionId,
        occurredAt: payment.occurredAt,
        status: payment.status,
      },
      creditableCents: charge && !reversedBy && left > 0 ? left : null,
      canVoidPayment:
        entry.kind === LedgerEntryKind.payment &&
        !reversedBy &&
        payment?.source === PaymentSource.manual &&
        payment.status === PaymentStatus.confirmed,
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
         COALESCE(SUM(amount_cents) FILTER (WHERE kind IN (${CHARGE_KINDS_SQL}) AND direction = 'debit'), 0)::bigint AS charges,
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
      entryNo: entry.entryNo,
      ref: ledgerRef(entry.kind, entry.direction, entry.entryNo),
      driverId: entry.driverId,
      direction: entry.direction,
      amountCents: entry.amountCents,
      kind: entry.kind,
      description: entry.description,
      effectiveDate: entry.effectiveDate,
      paymentId: entry.paymentId,
      reversalOfId: entry.reversalOfId,
      appliesToId: entry.appliesToId,
      internalNote: entry.internalNote,
      reversedById,
      canReverse: this.canReverse(entry.kind, reversedById !== null),
      createdById: entry.createdById,
      createdByEmail: entry.createdBy?.email ?? null,
      createdAt: entry.createdAt,
    };
  }

  /** True when an admin may reverse it here: not a reversal, not a payment credit, not reversed already. */
  private canReverse(kind: LedgerEntryKind, reversed: boolean): boolean {
    return (
      !reversed &&
      kind !== LedgerEntryKind.reversal &&
      kind !== LedgerEntryKind.payment
    );
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
  entry_no: string;
  driver_id: string;
  direction: LedgerDirection;
  amount_cents: number;
  kind: LedgerEntryKind;
  description: string;
  effective_date: string;
  payment_id: string | null;
  reversal_of_id: string | null;
  applies_to_id: string | null;
  internal_note: string | null;
  created_by_id: string | null;
  created_by_email: string | null;
  reversed_by_id: string | null;
  reversed_by_no: string | null;
  reversal_of_no: string | null;
  reversal_of_kind: string | null;
  reversal_of_direction: string | null;
  applies_to_no: string | null;
  applies_to_kind: string | null;
  applies_to_direction: string | null;
  payment_source: PaymentSource | null;
  payment_manual_method: PaymentManualMethod | null;
  payment_status: PaymentStatus | null;
  applied_cents: number;
  created_at: Date;
  running: string;
}
