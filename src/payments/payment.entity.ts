import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";

/** Where a payment was seen (spec section 4). Email sources come from the intake pipeline (M3). */
export enum PaymentSource {
  email_zelle = "email_zelle",
  email_cashapp = "email_cashapp",
  email_venmo = "email_venmo",
  email_stripe = "email_stripe",
  email_chime = "email_chime",
  /** A Zelle deposit seen in the bank account through Plaid (M5). */
  plaid_zelle = "plaid_zelle",
  /** Entered by an admin. */
  manual = "manual",
}

/**
 * Where a payment is in its life. Today (B56, D49) every payment is `unmatched` until matching assigns it a
 * driver, and then `confirmed`: one stage for every method, the email is the confirmation.
 * `reported` and `discrepancy` are kept for the bank check (Plaid, M5), which may bring the Zelle two-stage back.
 */
export enum PaymentStatus {
  /** Reserved for Zelle two-stage posting (M5): matched from the email, waiting for the bank deposit. Not used now. */
  reported = "reported",
  /** Assigned to a driver; the email confirmed it. Credited to the ledger once it exists (M1). */
  confirmed = "confirmed",
  /** Not assigned to a driver yet ("Needs review" once matching has looked at it). */
  unmatched = "unmatched",
  rejected = "rejected",
  /** Reserved for the bank check (M5): something does not add up; a human checks it. Not used now. */
  discrepancy = "discrepancy",
}

/** How a payment was assigned to its driver (D48). */
export enum MatchMethod {
  /** An exact alias of the driver (type-filtered), or the driver's own email/phone. */
  alias = "alias",
  /** The payer's name is exactly one driver's full name (capitals and spaces ignored). */
  name = "name",
  /** The AI picked the driver with a confidence of at least 0.7. */
  ai = "ai",
  /** An admin assigned it. */
  manual = "manual",
}

/**
 * A money event from any source. Maps to the `payments` table.
 *
 * Built in M3 with what extraction knows; the driver and matching columns came with matching (D48), the
 * Zelle pairing comes with M5. Never credits anyone by itself: the ledger (M1) does that.
 */
@Entity("payments")
// One payment per source record: the same email (or Plaid transaction) can never create two payments.
@Unique("payments_source_external_id_key", ["source", "externalId"])
// The same real payment announced by two different emails creates one payment (B37). Postgres treats
// NULLs as different, so payments without a transaction id are never blocked by this.
@Unique("payments_source_transaction_id_key", ["source", "transactionId"])
@Check("payments_amount_positive", `"amount_cents" > 0`)
// A payment has a driver exactly when it has a match method: never one without the other.
@Check(
  "payments_driver_has_method",
  `("driver_id" IS NULL) = ("match_method" IS NULL)`,
)
@Check(
  "payments_match_confidence_range",
  `"match_confidence" IS NULL OR ("match_confidence" >= 0 AND "match_confidence" <= 1)`,
)
@Index("payments_driver_idx", ["driverId"])
@Check(
  "payments_confidence_range",
  `"extraction_confidence" IS NULL OR ("extraction_confidence" >= 0 AND "extraction_confidence" <= 1)`,
)
export class Payment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "enum", enum: PaymentSource, enumName: "payment_source" })
  source: PaymentSource;

  /**
   * The record this payment came from: for email sources, the `inbound_emails` id. (The link lives here,
   * not on `inbound_emails`, because those rows are never updated, D37.)
   */
  @Column({ name: "external_id", type: "varchar", length: 255 })
  externalId: string;

  /**
   * The provider's own id for the payment (Zelle transaction number, Venmo transaction ID, ...), when the
   * email shows one. Kept only if it appears literally in the email, so a made-up id can never merge two
   * real payments.
   */
  @Column({
    name: "transaction_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  transactionId: string | null;

  /** Integer cents, never a float (spec rule 1). */
  @Column({ name: "amount_cents", type: "integer" })
  amountCents: number;

  /** The payer's name as the provider shows it. */
  @Column({ name: "sender_name", type: "varchar", length: 255 })
  senderName: string;

  /** The payer's handle, email or phone, if the email shows one. */
  @Column({
    name: "sender_handle",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  senderHandle: string | null;

  /** When the payment happened: the date in the email if there is one, otherwise when we received the email. */
  @Column({ name: "occurred_at", type: "timestamptz" })
  occurredAt: Date;

  /** How sure the AI was about what it extracted, 0 to 1. Null for sources that need no AI (Plaid, manual). */
  @Column({ name: "extraction_confidence", type: "real", nullable: true })
  extractionConfidence: number | null;

  @Column({ type: "enum", enum: PaymentStatus, enumName: "payment_status" })
  status: PaymentStatus;

  /** The driver this payment belongs to. Null while unmatched or waiting for review. */
  @Column({ name: "driver_id", type: "uuid", nullable: true })
  driverId: string | null;

  @ManyToOne(() => Driver, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver | null;

  /** The AI's best guess when it was not sure enough (< 0.7): shown to the admin as "Needs review". */
  @Column({ name: "suggested_driver_id", type: "uuid", nullable: true })
  suggestedDriverId: string | null;

  @ManyToOne(() => Driver, { onDelete: "SET NULL" })
  @JoinColumn({ name: "suggested_driver_id" })
  suggestedDriver?: Driver | null;

  @Column({
    name: "match_method",
    type: "enum",
    enum: MatchMethod,
    enumName: "payment_match_method",
    nullable: true,
  })
  matchMethod: MatchMethod | null;

  /** 1 for an alias, the AI's confidence for `ai` and for a suggestion, null for manual. */
  @Column({ name: "match_confidence", type: "real", nullable: true })
  matchConfidence: number | null;

  /** One line on why: the alias that matched, the AI's reason, or why matching failed. */
  @Column({ name: "match_explanation", type: "text", nullable: true })
  matchExplanation: string | null;

  /** The admin who assigned it by hand. */
  @Column({ name: "matched_by_id", type: "uuid", nullable: true })
  matchedById: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "matched_by_id" })
  matchedBy?: User | null;

  /** When matching looked at this payment. Null: not yet (matching picks it up on the next run). */
  @Column({ name: "match_attempted_at", type: "timestamptz", nullable: true })
  matchAttemptedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  /** Status changes with matching and Zelle pairing (M4, M5). */
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
