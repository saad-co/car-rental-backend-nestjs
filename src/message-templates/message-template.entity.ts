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
import { User } from "../users/user.entity.js";

/**
 * Which kind of text a template is (D58, D62). A kind can have many templates (the admin picks one when sending);
 * payment reminders (M6) will add their own kinds to the same table.
 */
export enum TemplateKind {
  /** Sent when an application is approved (B71), before the login text. */
  application_approved = "application_approved",
  /** Sent when an application is declined and the admin chooses to text the applicant (B72). */
  application_declined = "application_declined",
}

/** Longest template body: a few SMS segments at most. */
export const MAX_TEMPLATE_LENGTH = 1000;

/** Longest template name (the label in the dropdown). */
export const MAX_TEMPLATE_NAME_LENGTH = 60;

/**
 * A text message template, managed by admins in Settings (B73, B81, D58, D62; spec 4 `MessageTemplate`). Placeholders
 * such as `{firstName}` are filled in when the text is sent. Maps to the `message_templates` table; one "Default" per
 * kind is inserted by the migrations.
 */
@Entity("message_templates")
// Two templates of a kind cannot share a name, or the dropdown would show two identical entries.
@Unique("message_templates_kind_name", ["kind", "name"])
// Refused by the database even if the code had a bug: the system can never send a blank text.
@Check(
  "message_templates_body_length",
  `length(btrim("body")) BETWEEN 1 AND ${MAX_TEMPLATE_LENGTH}`,
)
export class MessageTemplate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 50 })
  kind: TemplateKind;

  /** The label admins pick from, e.g. "No valid licence". */
  @Column({ type: "varchar", length: MAX_TEMPLATE_NAME_LENGTH })
  name: string;

  /** The text, with placeholders. Line breaks are kept. */
  @Column({ type: "text" })
  body: string;

  /** Oldest first is the default order; the oldest template of a kind is also the one used when none is chosen. */
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

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
