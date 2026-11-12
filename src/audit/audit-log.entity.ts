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

/**
 * One line of the audit trail (spec section 4 `AuditLog`; Fleet revisions section 4): who did what to which record, when,
 * and what it looked like before and after. Append-only like the ledger: the database refuses an update or a delete.
 * Maps to the `audit_logs` table.
 *
 * `entityId` has no foreign key on purpose: the record it names may be the very thing that was deleted. `actorEmail` is
 * copied for the same reason: the line must still say who acted if that account is removed later.
 */
@Entity("audit_logs")
@Index("audit_logs_entity_idx", ["entityType", "entityId", "createdAt"])
@Index("audit_logs_created_idx", ["createdAt"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** The admin who acted; null if the account was removed later (then `actorEmail` still says who). */
  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "actor_id" })
  actor?: User | null;

  /** The actor's email when the line was written; null for an action by the system itself. */
  @Column({ name: "actor_email", type: "varchar", length: 255, nullable: true })
  actorEmail: string | null;

  /** What happened, as `<entity>.<verb>`, for example `application.delete`. */
  @Column({ type: "varchar", length: 60 })
  action: string;

  /** Which kind of record: `application`, later `ledger_entry` and so on. */
  @Column({ name: "entity_type", type: "varchar", length: 40 })
  entityType: string;

  @Column({ name: "entity_id", type: "uuid" })
  entityId: string;

  /** The record before the action (what a delete removed); null for a creation. */
  @Column({ type: "jsonb", nullable: true })
  before: Record<string, unknown> | null;

  /** The record after the action; null for a delete. */
  @Column({ type: "jsonb", nullable: true })
  after: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
