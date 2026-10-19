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
  /** A charge or credit an admin entered by hand, with a reason and the date it belongs to. */
  adjustment = "adjustment",
  /** Cancels another entry by the same amount in the opposite direction. */
  reversal = "reversal",
}

/** Longest description or reason. */
export const MAX_DESCRIPTION_LENGTH = 500;

/** $1,000,000 in cents: a sanity cap far above any real entry, so a typo of extra zeros is refused. */
export const MAX_ENTRY_CENTS = 100_000_000;

/**
 * One line of a driver's ledger (spec section 4, D6, D60). Maps to the `ledger_entries` table.
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
// Finds the credits applied against one charge.
@Index("ledger_entries_applies_to_idx", ["appliesToId"])
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
// A manual entry always names the admin who entered it.
@Check(
  "ledger_entries_adjustment_shape",
  `"kind" <> 'adjustment' OR "created_by_id" IS NOT NULL`,
)
// A staff note, when there is one, is not blank and not longer than a description.
@Check(
  "ledger_entries_internal_note_shape",
  `"internal_note" IS NULL OR length(btrim("internal_note")) BETWEEN 1 AND ${MAX_DESCRIPTION_LENGTH}`,
)
// Only a credit entered by an admin can be applied against a charge, never against itself.
@Check(
  "ledger_entries_applies_to_shape",
  `"applies_to_id" IS NULL OR ("kind" = 'adjustment' AND "direction" = 'credit' AND "applies_to_id" <> "id")`,
)
export class LedgerEntry {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /**
   * A short number for people ("CH-1042" on screen). Made by the database (an identity column), so it never repeats
   * and, because rows never change, never changes. `insert: false`: the code never sends it, Postgres fills it in.
   * bigint comes back from the driver as a string, hence the transformer.
   */
  @Column({
    name: "entry_no",
    type: "bigint",
    generated: "identity",
    generatedIdentity: "ALWAYS",
    insert: false,
    update: false,
    unique: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  entryNo: number;

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

  /** What it is and why, e.g. "Venmo payment from J. Smith" or the admin's reason. */
  @Column({ type: "varchar", length: MAX_DESCRIPTION_LENGTH })
  description: string;

  /**
   * A note for staff only (the client's "Internal note"), typed when the entry is made and never changed: entries are
   * append-only. Never printed on a driver's statement.
   */
  @Column({
    name: "internal_note",
    type: "varchar",
    length: MAX_DESCRIPTION_LENGTH,
    nullable: true,
  })
  internalNote: string | null;

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
   * The charge this credit is applied against ("credit against this charge", e.g. a waived late fee). The charge
   * keeps its row; its "left to credit" is its amount minus the active credits pointing at it.
   */
  @Column({ name: "applies_to_id", type: "uuid", nullable: true })
  appliesToId: string | null;

  @ManyToOne(() => LedgerEntry, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "applies_to_id" })
  appliesTo?: LedgerEntry | null;

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
