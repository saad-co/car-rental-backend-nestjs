import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { InspectionShot } from "./inspection-shot.entity.js";
import { Inspection } from "./inspection.entity.js";

/**
 * The driver's answer to "Is there any damage on the <shot>?", asked after each required photo (Abulkalam, 2026-11-17, D112). One
 * row per inspection and shot (the primary key is the pair, so a repeated answer updates the row instead of adding one). Kept
 * apart from the photo because the answer reaches the server at once, while the photo may still be waiting in the phone's queue.
 *
 * Mongo comparison: a small map `{ shotId: hasDamage }` that would sit inside the inspection document; here it is its own table so
 * the database can check each shot id against `inspection_shots`.
 */
@Entity("inspection_shot_answers")
export class InspectionShotAnswer {
  @PrimaryColumn({ name: "inspection_id", type: "uuid" })
  inspectionId: string;

  @ManyToOne(() => Inspection, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "inspection_id" })
  inspection?: Inspection;

  @PrimaryColumn({ name: "shot_id", type: "varchar", length: 40 })
  shotId: string;

  @ManyToOne(() => InspectionShot, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "shot_id" })
  shot?: InspectionShot;

  /** Yes = the driver saw damage and adds close-ups; No = none seen. */
  @Column({ name: "has_damage", type: "boolean" })
  hasDamage: boolean;

  /** When the driver last answered (server time). */
  @UpdateDateColumn({ name: "answered_at", type: "timestamptz" })
  answeredAt: Date;
}
