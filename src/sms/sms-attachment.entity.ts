import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { SmsMessage } from "./sms-message.entity.js";

/** Where a file is in being copied from Quo into our own bucket (D50). */
export enum SmsAttachmentStatus {
  /** Known, not copied yet (or a copy failed and will be retried). */
  pending = "pending",
  /** Copied into our bucket under `storageKey`. */
  stored = "stored",
  /** Gave up after repeated failures; `lastError` says why. */
  failed = "failed",
}

/**
 * A file (photo, document) that came with a text. Maps to the `sms_attachments` table.
 * Quo only gives us a link, so we copy the file into our own bucket and show it through short-lived signed
 * links. Whether Quo's links expire is unknown (B57).
 */
@Entity("sms_attachments")
// The same file position of the same text can never be recorded twice (repeated webhooks and syncs).
@Unique("sms_attachments_message_position_key", ["messageId", "position"])
@Check(
  "sms_attachments_stored_has_file",
  `"status" <> 'stored' OR ("storage_key" IS NOT NULL AND "size_bytes" IS NOT NULL)`,
)
@Check(
  "sms_attachments_failed_has_error",
  `"status" <> 'failed' OR "last_error" IS NOT NULL`,
)
export class SmsAttachment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "message_id", type: "uuid" })
  messageId: string;

  @ManyToOne(() => SmsMessage, (message) => message.attachments, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "message_id" })
  message?: SmsMessage;

  /** 0, 1, 2... the order of the files in the text. */
  @Column({ type: "integer" })
  position: number;

  /** Quo's link to the file. */
  @Column({ name: "source_url", type: "text" })
  sourceUrl: string;

  /** MIME type when Quo tells us, otherwise taken from the download. */
  @Column({
    name: "content_type",
    type: "varchar",
    length: 150,
    nullable: true,
  })
  contentType: string | null;

  @Column({ name: "size_bytes", type: "integer", nullable: true })
  sizeBytes: number | null;

  @Column({
    type: "enum",
    enum: SmsAttachmentStatus,
    enumName: "sms_attachment_status",
    default: SmsAttachmentStatus.pending,
  })
  status: SmsAttachmentStatus;

  /** Where the copy lives in our bucket. */
  @Column({
    name: "storage_key",
    type: "varchar",
    length: 300,
    nullable: true,
  })
  storageKey: string | null;

  /** Download attempts so far. */
  @Column({ type: "integer", default: 0 })
  attempts: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
