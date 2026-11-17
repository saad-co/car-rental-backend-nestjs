import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../users/user.entity.js";
import { Inspection } from "./inspection.entity.js";

/**
 * What can happen to an inspection, as written in its activity log. A plain text column (not a database enum) on purpose: the
 * log only grows, and chat 2 adds `reviewed`, `flagged` and so on without a migration each time.
 */
export type InspectionEventType =
  | "created"
  | "link_sent"
  | "link_issued"
  | "opened"
  | "photo_uploaded"
  | "submitted"
  | "language_changed"
  | "revoked"
  | "reviewed"
  | "flagged"
  | "staff_note"
  | "damage_marked"
  | "damage_cleared"
  | "damage_charged";

/**
 * One line of an inspection's activity log (spec p. 11: link sent, opened, each upload, submitted, reviewed; who and when).
 * Maps to `inspection_events`. Written, never changed. A staff action is also written to `audit_logs` (D95); an event by the
 * driver or the system has no `actorId`.
 */
@Entity("inspection_events")
// Reads one inspection's log in order.
@Index("inspection_events_inspection_created_idx", [
  "inspectionId",
  "createdAt",
])
export class InspectionEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "inspection_id", type: "uuid" })
  inspectionId: string;

  @ManyToOne(() => Inspection, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "inspection_id" })
  inspection?: Inspection;

  @Column({ type: "varchar", length: 40 })
  type: InspectionEventType;

  /** The admin who did it; null = the driver or the system. */
  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "actor_id" })
  actor?: User | null;

  /** Small extra facts about the event (which shot, which text mode...). Never a token or a photo. */
  @Column({ type: "jsonb", nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
