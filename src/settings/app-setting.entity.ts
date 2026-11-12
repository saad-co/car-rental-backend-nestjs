import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../users/user.entity.js";

/**
 * One setting of the app (spec section 4 `Setting`): a name and a text value, for the few switches and values staff change
 * in Settings and that are not environment variables. Maps to the `app_settings` table. Today: the payment-reminders
 * switch and the payment link (Fleet revisions section 6).
 *
 * Mongo comparison: a tiny `settings` collection of `{ _id: "payment_link", value: "..." }` documents.
 */
@Entity("app_settings")
export class AppSetting {
  @PrimaryColumn({ type: "varchar", length: 60 })
  key: string;

  @Column({ type: "text" })
  value: string;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  /** The admin who last changed it; null if that account was removed. */
  @Column({ name: "updated_by_id", type: "uuid", nullable: true })
  updatedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "updated_by_id" })
  updatedBy?: User | null;
}
