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
import { User } from "../../users/user.entity.js";
import { Application } from "../application.entity.js";

/** Longest note an admin can write. */
export const MAX_NOTE_LENGTH = 2000;

/**
 * An internal note on an application (B74, D57), e.g. "insufficient earnings" or "too far from the service area".
 * Staff only: never sent to the applicant, never shown in the driver portal. Maps to the `application_notes` table.
 *
 * A list of notes rather than one text field on the application: each keeps its own author and time, and two admins
 * writing at once cannot overwrite each other. Notes are never edited; only their author may delete one.
 */
@Entity("application_notes")
// Loads one application's notes newest first without reading the others (Mongo: `{ applicationId: 1, createdAt: -1 }`).
@Index("application_notes_application_created_idx", [
  "applicationId",
  "createdAt",
])
// Refused by the database even if the code had a bug: no empty or whitespace-only note, nothing over the limit.
@Check(
  "application_notes_body_length",
  `length(btrim("body")) BETWEEN 1 AND ${MAX_NOTE_LENGTH}`,
)
export class ApplicationNote {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "application_id", type: "uuid" })
  applicationId: string;

  /** Deleting the application (B66, hard delete) deletes its notes with it. */
  @ManyToOne(() => Application, { onDelete: "CASCADE" })
  @JoinColumn({ name: "application_id" })
  application?: Application;

  /** The admin who wrote it. Null only if that account was removed later: the note stays. */
  @Column({ name: "author_id", type: "uuid", nullable: true })
  authorId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "author_id" })
  author?: User | null;

  /** The note as written (trimmed), line breaks kept. */
  @Column({ type: "text" })
  body: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
