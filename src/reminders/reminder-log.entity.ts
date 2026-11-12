import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { SmsMessage } from "../sms/sms-message.entity.js";
import { ReminderKind } from "./reminder-rules.js";

/** What became of the reminder: really sent, only composed (a dry run), or refused (`error` says why). */
export enum ReminderStatus {
  sent = "sent",
  composed = "composed",
  failed = "failed",
}

/**
 * One payment reminder to a driver (Fleet revisions section 6): what was texted, when, in which SMS mode, and what the
 * driver owed at that moment. Staff read them on the driver's page. Maps to the `reminder_logs` table.
 *
 * `dedupeKey` is the idempotency key of the reminder (for example `late:<driver>:<episode>`): unique per mode among the
 * rows that did not fail (a partial unique index, written in the migration), so the same reminder can never be recorded
 * twice, a dry run never blocks the live send, and a failed send may be tried again.
 */
@Entity("reminder_logs")
@Index("reminder_logs_driver_created_idx", ["driverId", "createdAt"])
export class ReminderLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "driver_id", type: "uuid" })
  driverId: string;

  @ManyToOne(() => Driver, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver;

  @Column({ type: "varchar", length: 30 })
  kind: ReminderKind;

  /** For a high-balance reminder: how many payments behind (2 to 5). */
  @Column({ type: "smallint", nullable: true })
  tier: number | null;

  @Column({ name: "dedupe_key", type: "varchar", length: 120 })
  dedupeKey: string;

  @Column({ type: "varchar", length: 10 })
  mode: "dry_run" | "live";

  @Column({ type: "varchar", length: 10 })
  status: ReminderStatus;

  /** Why a send failed, in plain words (from the texting layer). Null unless `failed`. */
  @Column({ type: "text", nullable: true })
  error: string | null;

  /** The text as composed, placeholders filled in. */
  @Column({ type: "text" })
  body: string;

  /** What was past due when it was composed, in cents. */
  @Column({ name: "past_due_cents", type: "integer" })
  pastDueCents: number;

  /** The ledger balance when it was composed, in cents. */
  @Column({ name: "balance_cents", type: "integer" })
  balanceCents: number;

  /** The saved text in the driver's chat; null if it was never saved or was deleted later. */
  @Column({ name: "sms_message_id", type: "uuid", nullable: true })
  smsMessageId: string | null;

  @ManyToOne(() => SmsMessage, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "sms_message_id" })
  smsMessage?: SmsMessage | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
