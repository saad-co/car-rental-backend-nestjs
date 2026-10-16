import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { Payment } from "../payments/payment.entity.js";
import { User } from "../users/user.entity.js";

/** Debit: the driver owes more (a charge). Credit: the driver owes less (a payment, a discount). */
export enum LedgerDirection {
  debit = "debit",
  credit = "credit",
}

/** What made the entry. */
export enum LedgerEntryKind {
  /** A rent charge from the billing job. Reserved for M2: nothing writes it yet. */
  rent = "rent",
  /** A confirmed payment credited to its driver. */
  payment = "payment",
  /** A charge or credit an admin entered by hand, always with a category. */
  adjustment = "adjustment",
  /** Cancels another entry by the same amount in the opposite direction. */
  reversal = "reversal",
}

/** The type an admin picks for a manual entry (D58). The direction follows from it. */
export enum LedgerCategory {
  late_fee = "late_fee",
  /** Repairs such as a flat tire. */
  repair = "repair",
  damage = "damage",
  toll = "toll",
  ticket = "ticket",
  cleaning = "cleaning",
  other_charge = "other_charge",
  discount = "discount",
  goodwill = "goodwill",
  other_credit = "other_credit",
  /** What the driver owed (debit) or had in credit (credit) when the ledger started. At most one per driver. */
  opening_balance = "opening_balance",
}

/** Categories that are always a debit (the driver owes more). */
export const CHARGE_CATEGORIES: readonly LedgerCategory[] = [
  LedgerCategory.late_fee,
  LedgerCategory.repair,
  LedgerCategory.damage,
  LedgerCategory.toll,
  LedgerCategory.ticket,
  LedgerCategory.cleaning,
  LedgerCategory.other_charge,
];

/** Categories that are always a credit (the driver owes less). */
export const CREDIT_CATEGORIES: readonly LedgerCategory[] = [
  LedgerCategory.discount,
  LedgerCategory.goodwill,
  LedgerCategory.other_credit,
];

/** Longest description or reason. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** $1,000,000 in cents: a sanity cap far above any real entry, so a typo of extra zeros is refused. */
export const MAX_ENTRY_CENTS = 100_000_000;

/** SQL list of category names, for the CHECK constraints below. */
const sqlList = (values: readonly string[]) =>
  values.map((v) => `'${v}'`).join(", ");

/**
 * One line of a driver's ledger (spec section 4, D6, D58). Maps to the `ledger_entries` table.
 *
 * Append-only: a database trigger (added in the migration) refuses every UPDATE and DELETE, so a row can never
 * change after it is written. A mistake is cancelled by a `reversal` entry instead. The balance is never stored:
 * it is always the sum of the rows (credits minus debits), so it cannot drift from the history.
 *
 * Mongo comparison: instead of `$inc` on `driver.balance`, every money event is its own immutable document, and the
 * balance is an aggregation over them.
 */
@Entity("ledger_entries")
// Reads one driver's history in date order without scanning other drivers.
@Index("ledger_entries_driver_date_idx", [
  "driverId",
  "effectiveDate",
  "createdAt",
])
@Index("ledger_entries_payment_idx", ["paymentId"])
// At most one opening balance per driver: a partial unique index only covers rows with that category.
@Index("ledger_entries_one_opening_balance_key", ["driverId"], {
  unique: true,
  where: `"category" = 'opening_balance'`,
})
@Check(
  "ledger_entries_amount_range",
  `"amount_cents" > 0 AND "amount_cents" <= ${MAX_ENTRY_CENTS}`,
)
@Check(
  "ledger_entries_description_length",
  `length(btrim("description")) BETWEEN 1 AND ${MAX_DESCRIPTION_LENGTH}`,
)
// A payment entry is always a credit with its payment; only payment entries and their reversals point at a payment.
@Check(
  "ledger_entries_payment_shape",
  `("kind" <> 'payment' OR ("payment_id" IS NOT NULL AND "direction" = 'credit')) AND ("payment_id" IS NULL OR "kind" IN ('payment', 'reversal'))`,
)
// A reversal always names the entry it cancels, and only a reversal does; never itself.
@Check(
  "ledger_entries_reversal_shape",
  `("kind" = 'reversal') = ("reversal_of_id" IS NOT NULL) AND ("reversal_of_id" IS NULL OR "reversal_of_id" <> "id")`,
)
// A manual entry always has a category and the admin who entered it; nothing else has a category.
@Check(
  "ledger_entries_adjustment_shape",
  `("kind" = 'adjustment') = ("category" IS NOT NULL) AND ("kind" <> 'adjustment' OR "created_by_id" IS NOT NULL)`,
)
// The category decides the direction, so a "late fee" can never be a credit.
@Check(
  "ledger_entries_category_direction",
  `"category" IS NULL OR "category" = 'opening_balance' OR ("category" IN (${sqlList(CHARGE_CATEGORIES)}) AND "direction" = 'debit') OR ("category" IN (${sqlList(CREDIT_CATEGORIES)}) AND "direction" = 'credit')`,
)
export class LedgerEntry {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "driver_id", type: "uuid" })
  driverId: string;

  /** RESTRICT: a driver with money history can never be deleted. */
  @ManyToOne(() => Driver, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver;

  @Column({ type: "enum", enum: LedgerDirection, enumName: "ledger_direction" })
  direction: LedgerDirection;

  /** Integer cents, always positive (spec rule 1); the direction says which way it goes. */
  @Column({ name: "amount_cents", type: "integer" })
  amountCents: number;

  @Column({
    type: "enum",
    enum: LedgerEntryKind,
    enumName: "ledger_entry_kind",
  })
  kind: LedgerEntryKind;

  /** Only for `adjustment` entries. */
  @Column({
    type: "enum",
    enum: LedgerCategory,
    enumName: "ledger_category",
    nullable: true,
  })
  category: LedgerCategory | null;

  /** What it is and why, e.g. "Venmo payment from J. Smith" or the admin's reason. */
  @Column({ type: "varchar", length: MAX_DESCRIPTION_LENGTH })
  description: string;

  /**
   * The calendar day the money belongs to, in America/Chicago ("YYYY-MM-DD"). Weekly and monthly summaries group by
   * this, so time zones and daylight saving can never move an entry into another period. `createdAt` says when it
   * was recorded, which can be later (a flat tire on Monday entered on Friday).
   */
  @Column({ name: "effective_date", type: "date" })
  effectiveDate: string;

  /** The payment this credit (or its reversal) is for. */
  @Column({ name: "payment_id", type: "uuid", nullable: true })
  paymentId: string | null;

  @ManyToOne(() => Payment, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "payment_id" })
  payment?: Payment | null;

  /** The entry this one cancels. Unique: an entry can be reversed only once. */
  @Column({
    name: "reversal_of_id",
    type: "uuid",
    nullable: true,
    unique: true,
  })
  reversalOfId: string | null;

  @ManyToOne(() => LedgerEntry, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "reversal_of_id" })
  reversalOf?: LedgerEntry | null;

  /**
   * The admin who made it; null for the system (matching). RESTRICT, not SET NULL: SET NULL would be an UPDATE of
   * this row, which the append-only trigger refuses.
   */
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  /**
   * Unique per real-world event, so a retry or a double click can never write it twice (spec rule 3), e.g.
   * `payment:<paymentId>`, `reversal:<entryId>`, `manual:<requestKey>`.
   */
  @Column({
    name: "idempotency_key",
    type: "varchar",
    length: 200,
    unique: true,
  })
  idempotencyKey: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
