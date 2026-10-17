import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../users/user.entity.js";
import type { SmsAttachment } from "./sms-attachment.entity.js";

export enum SmsDirection {
  inbound = "inbound",
  outbound = "outbound",
}

/** How an outbound text was handled (SMS_MODE, D50). Inbound texts have no mode. */
export enum SmsMode {
  /** Saved and shown, never sent. */
  dry_run = "dry_run",
  /** Handed to Quo (or, for texts synced from Quo, sent from the Quo app or by Quo itself). */
  live = "live",
}

/** Where a text is in its life. Only moves forward (see `SMS_STATUS_RANK`). */
export enum SmsStatus {
  /** Dry run: composed and saved, not sent. */
  composed = "composed",
  queued = "queued",
  sent = "sent",
  delivered = "delivered",
  undelivered = "undelivered",
  failed = "failed",
  /** An inbound text. */
  received = "received",
}

/**
 * Order of the statuses. Quo's webhooks can arrive late, twice or out of order, so a text's status only
 * ever moves to a higher rank: a late "sent" never undoes "delivered".
 */
export const SMS_STATUS_RANK: Record<SmsStatus, number> = {
  [SmsStatus.composed]: 0,
  [SmsStatus.queued]: 1,
  [SmsStatus.sent]: 2,
  [SmsStatus.delivered]: 3,
  [SmsStatus.undelivered]: 3,
  [SmsStatus.failed]: 3,
  [SmsStatus.received]: 3,
};

/**
 * One text with one contact, in either direction (D50). Maps to the `sms_messages` table.
 *
 * A conversation is identified by the contact's phone number, not by a driver: an applicant is not a driver
 * yet, and the thread must survive approval. Rows come from our own sends, Quo's webhook and the history sync.
 */
@Entity("sms_messages")
// The same Quo message can never be stored twice (webhook retries, repeated syncs). Postgres treats NULLs as
// different, so dry-run texts and failed sends, which have no Quo id, are never blocked by this.
@Index("sms_messages_quo_message_id_key", ["quoMessageId"], { unique: true })
@Index("sms_messages_contact_idx", ["contactPhone", "occurredAt"])
@Check("sms_messages_phone_e164", `"contact_phone" ~ '^\\+[1-9][0-9]{6,14}$'`)
// Inbound texts are always "received", and nothing else is.
@Check(
  "sms_messages_inbound_is_received",
  `("direction" = 'inbound') = ("status" = 'received')`,
)
// Only outbound texts have a mode.
@Check(
  "sms_messages_outbound_has_mode",
  `("direction" = 'outbound') = ("mode" IS NOT NULL)`,
)
// A dry run is a composed text that never reached Quo, and nothing else is "composed".
@Check(
  "sms_messages_dry_run_is_composed",
  `COALESCE("mode" = 'dry_run', false) = ("status" = 'composed')`,
)
@Check(
  "sms_messages_dry_run_has_no_quo_id",
  `"mode" IS DISTINCT FROM 'dry_run' OR "quo_message_id" IS NULL`,
)
// A failure always says why (no silent failure).
@Check(
  "sms_messages_failure_has_error",
  `"status" NOT IN ('failed', 'undelivered') OR "error" IS NOT NULL`,
)
export class SmsMessage {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** Quo's id for the text (`AC...`). Null for a dry run, or a live send Quo refused. */
  @Column({
    name: "quo_message_id",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  quoMessageId: string | null;

  @Column({ type: "enum", enum: SmsDirection, enumName: "sms_direction" })
  direction: SmsDirection;

  /** The other party's number, E.164. */
  @Column({ name: "contact_phone", type: "varchar", length: 16 })
  contactPhone: string;

  /** The words. Empty for a text that is only a photo or file. */
  @Column({ type: "text" })
  body: string;

  @Column({
    type: "enum",
    enum: SmsMode,
    enumName: "sms_mode",
    nullable: true,
  })
  mode: SmsMode | null;

  @Column({ type: "enum", enum: SmsStatus, enumName: "sms_status" })
  status: SmsStatus;

  /** Why a text failed (ours or Quo's reason). */
  @Column({ type: "text", nullable: true })
  error: string | null;

  /** The admin who sent it from our chat. Null for inbound texts and texts sent from the Quo app. */
  @Column({ name: "sent_by_id", type: "uuid", nullable: true })
  sentById: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "sent_by_id" })
  sentBy?: User | null;

  /** When the text happened: Quo's creation time, or our own for a dry run. Orders the chat. */
  @Column({ name: "occurred_at", type: "timestamptz" })
  occurredAt: Date;

  @OneToMany("SmsAttachment", "message")
  attachments?: SmsAttachment[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
