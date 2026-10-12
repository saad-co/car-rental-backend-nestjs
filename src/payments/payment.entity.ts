import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

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

/** Where a payment is in its life (spec 6.3). Until matching exists (M4), every new payment is `unmatched`. */
export enum PaymentStatus {
  /** Zelle email matched to a driver; waits for the bank deposit. Stops reminders, no ledger credit yet. */
  reported = "reported",
  /** Final: credited to the driver's ledger. */
  confirmed = "confirmed",
  /** Not assigned to a driver yet; shown in the unrecognised bucket. */
  unmatched = "unmatched",
  rejected = "rejected",
  /** Something does not add up (e.g. a Zelle email with no deposit after 72 hours); a human checks it. */
  discrepancy = "discrepancy",
}

/**
 * A money event from any source. Maps to the `payments` table.
 *
 * Built in M3 with only what extraction knows. The driver and matching columns arrive with M4, the
 * Zelle pairing with M5. Never credits anyone by itself: the ledger (M1) does that.
 */
@Entity("payments")
// One payment per source record: the same email (or Plaid transaction) can never create two payments.
@Unique("payments_source_external_id_key", ["source", "externalId"])
// The same real payment announced by two different emails creates one payment (B37). Postgres treats
// NULLs as different, so payments without a transaction id are never blocked by this.
@Unique("payments_source_transaction_id_key", ["source", "transactionId"])
@Check("payments_amount_positive", `"amount_cents" > 0`)
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

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  /** Status changes with matching and Zelle pairing (M4, M5). */
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
