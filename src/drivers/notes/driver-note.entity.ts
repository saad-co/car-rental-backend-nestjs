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
import { Driver } from "../driver.entity.js";

/** Longest note an admin can write (the same as an application note, B74). */
export const MAX_DRIVER_NOTE_LENGTH = 2000;

/**
 * An internal note about a driver's account, shown on the driver's ledger page (Fleet revisions section 5). Staff only:
 * never on the driver's statement, never sent to the driver. Maps to the `driver_notes` table.
 *
 * The same design as an application note (D57): a list of notes, each with its own author and time, so two admins
 * writing at once cannot overwrite each other. Notes are never edited; only their author may delete one.
 */
@Entity("driver_notes")
// Loads one driver's notes newest first without reading the others.
@Index("driver_notes_driver_created_idx", ["driverId", "createdAt"])
// Refused by the database even if the code had a bug: no empty or whitespace-only note, nothing over the limit.
@Check(
  "driver_notes_body_length",
  `length(btrim("body")) BETWEEN 1 AND ${MAX_DRIVER_NOTE_LENGTH}`,
)
export class DriverNote {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "driver_id", type: "uuid" })
  driverId: string;

  /** `RESTRICT`: drivers are archived, never deleted, so a driver's notes are never silently dropped with the row. */
  @ManyToOne(() => Driver, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver;

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
