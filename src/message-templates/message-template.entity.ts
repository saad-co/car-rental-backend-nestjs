import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../users/user.entity.js";

/**
 * Which text a template is (D58). The key is the row's primary key: one row per template, never two. Payment
 * reminders (M6) will add their own keys to the same table.
 */
export enum TemplateKey {
  /** Sent automatically when an application is approved (B71), before the login text. */
  application_approved = "application_approved",
  /** Sent when an application is declined and the admin chooses to text the applicant (B72). */
  application_declined = "application_declined",
}

/** Longest template body: a few SMS segments at most. */
export const MAX_TEMPLATE_LENGTH = 1000;

/**
 * A text message template, editable by admins in Settings (B73, D58; spec 4 `MessageTemplate`). Placeholders such as
 * `{firstName}` are filled in when the text is sent. Maps to the `message_templates` table; the default texts are
 * inserted by the migration that creates it.
 */
@Entity("message_templates")
// Refused by the database even if the code had a bug: the system can never send a blank text.
@Check(
  "message_templates_body_length",
  `length(btrim("body")) BETWEEN 1 AND ${MAX_TEMPLATE_LENGTH}`,
)
export class MessageTemplate {
  @PrimaryColumn({ type: "varchar", length: 50 })
  key: TemplateKey;

  /** The text, with placeholders. Line breaks are kept. */
  @Column({ type: "text" })
  body: string;

  /** When it was last saved (or inserted by the migration). */
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  /** The admin who last edited it; null for the default text, or if that account was removed. */
  @Column({ name: "updated_by_id", type: "uuid", nullable: true })
  updatedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "updated_by_id" })
  updatedBy?: User | null;
}
