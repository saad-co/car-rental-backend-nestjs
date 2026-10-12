import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  ValueTransformer,
} from "typeorm";
import {
  EXPECTED_DKIM_DOMAINS,
  type EmailProvider,
} from "./dkim-verification.js";

/** What happened to an email once the intake pipeline had looked at it. */
export enum InboundEmailStatus {
  /** Verified, and a payment was extracted from it. */
  processed = "processed",
  /** Failed the DKIM check (see `verifyDkim`). Never credits anyone. */
  rejected_unverified = "rejected_unverified",
  /** Verified, but the extracted data was missing or failed `validateExtraction`. */
  extraction_failed = "extraction_failed",
  /** Verified, but the email is not a payment (e.g. a Chase statement notice). */
  not_payment = "not_payment",
  /**
   * Verified payment whose provider transaction id is already stored from another email (B37), e.g. a
   * duplicate forward. No second payment; `statusReason` names the existing one.
   */
  duplicate_payment = "duplicate_payment",
}

/** The providers we accept, plus `unknown` for an email whose sender is not one of them. */
export type InboundEmailProvider = EmailProvider | "unknown";

/**
 * Same list as `EXPECTED_DKIM_DOMAINS` plus `unknown`, so adding a provider there adds it to the
 * database enum too (through a new migration) instead of the two lists drifting apart.
 */
export const PROVIDER_VALUES: InboundEmailProvider[] = [
  ...(Object.keys(EXPECTED_DKIM_DOMAINS) as EmailProvider[]),
  "unknown",
];

/**
 * TypeORM returns Postgres `bigint` as a string (it can exceed JavaScript's safe integer range).
 * Our values (IMAP UIDs and UIDVALIDITY) stay far below that range, so we convert to a number
 * and the rest of the code never sees a string.
 */
const bigintAsNumber: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * One row per email the intake pipeline has processed (spec section 4). Maps to `inbound_emails`.
 *
 * It is a record of what happened, so rows are only ever inserted, never updated: there is no
 * `updated_at`. A message that is already here is skipped, which is what stops it being
 * reprocessed and its real outcome overwritten (reference defect 2).
 */
@Entity("inbound_emails")
@Unique("inbound_emails_message_key", ["mailbox", "imapUidValidity", "imapUid"])
@Unique("inbound_emails_gmail_message_key", ["mailbox", "gmailMessageId"])
@Index("inbound_emails_received_at_idx", ["receivedAt"])
@Check("inbound_emails_mailbox_lowercase", `"mailbox" = lower("mailbox")`)
@Check("inbound_emails_uid_positive", `"imap_uid" > 0`)
@Check(
  "inbound_emails_failure_has_reason",
  // Compared as text: a CHECK written against enum literals cannot name a value added in the same migration.
  `"status"::text NOT IN ('rejected_unverified', 'extraction_failed', 'duplicate_payment') OR "status_reason" IS NOT NULL`,
)
export class InboundEmail {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** The mailbox the email was read from, `gonzobilling@gmail.com` (D38), lower-case. */
  @Column({ type: "varchar", length: 254 })
  mailbox: string;

  /**
   * IMAP's UIDVALIDITY of the mailbox when the email was read. A UID is only stable while this
   * number stays the same; if the server rebuilds the mailbox, UIDs start again. Together with
   * `mailbox` and `imapUid` it identifies the message (the unique constraint above).
   */
  @Column({
    name: "imap_uid_validity",
    type: "bigint",
    transformer: bigintAsNumber,
  })
  imapUidValidity: number;

  /** The message's number inside that mailbox. */
  @Column({ name: "imap_uid", type: "bigint", transformer: bigintAsNumber })
  imapUid: number;

  /**
   * Gmail's permanent id for the message (`X-GM-MSGID`, a 64-bit number kept as text). Unlike the UID, it
   * never changes, even if Gmail resets UIDVALIDITY, so it is what stops an email being stored twice (D40).
   */
  @Column({ name: "gmail_message_id", type: "varchar", length: 32 })
  gmailMessageId: string;

  /** The `Message-ID` header. For reference only (e.g. matching the Gmail copy); not used to deduplicate. */
  @Column({ name: "message_id", type: "varchar", length: 998, nullable: true })
  messageId: string | null;

  @Column({
    name: "from_address",
    type: "varchar",
    length: 254,
    nullable: true,
  })
  fromAddress: string | null;

  @Column({ type: "text", default: "" })
  subject: string;

  /**
   * When OUR mail server received the email (the IMAP internal date). Not the `Date` header,
   * which the sender controls and can fake.
   */
  @Column({ name: "received_at", type: "timestamptz" })
  receivedAt: Date;

  /** Result of `verifyDkim`: true only for `dkim=pass` from the provider's exact domain. */
  @Column({ name: "auth_dkim_pass", type: "boolean" })
  authDkimPass: boolean;

  @Column({
    name: "auth_dkim_domain",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  authDkimDomain: string | null;

  @Column({
    type: "enum",
    enum: PROVIDER_VALUES,
    enumName: "inbound_email_provider",
  })
  provider: InboundEmailProvider;

  @Column({
    type: "enum",
    enum: InboundEmailStatus,
    enumName: "inbound_email_status",
  })
  status: InboundEmailStatus;

  /**
   * Why the email ended in this status. The `inbound_emails_failure_has_reason` CHECK makes it
   * impossible to save a rejected or failed email without one (no silent failure).
   */
  @Column({ name: "status_reason", type: "text", nullable: true })
  statusReason: string | null;

  /** The cleaned body text. Stored only for emails from allow-listed payment senders. */
  @Column({ name: "body_text", type: "text", nullable: true })
  bodyText: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
