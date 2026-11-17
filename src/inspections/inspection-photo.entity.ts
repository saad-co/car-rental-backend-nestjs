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
import { InspectionShot } from "./inspection-shot.entity.js";
import { Inspection } from "./inspection.entity.js";

/** The `shotId` of a damage close-up. Since D112 a close-up belongs to a required shot (`parentShotId`). */
export const DAMAGE_SHOT_ID = "DAMAGE";

/** The most free-standing damage photos one inspection could hold before D112 (old inspections only). */
export const MAX_DAMAGE_PHOTOS = 15;

/** The most damage close-ups one required shot can hold (Abulkalam, 2026-11-17: "up to 4-5"). */
export const MAX_CLOSE_UPS_PER_SHOT = 5;

/** Longest note a driver can write under a photo. The client's text shows "characters left", so a limit is needed. */
export const MAX_PHOTO_NOTE_LENGTH = 200;

/**
 * One photo of an inspection: a required shot (`shotId` = the shot's id, `position` 1), a damage close-up of one shot (`DAMAGE`,
 * `parentShotId` = that shot, `position` 1 to 5, D112), or, in inspections made before D112, a free-standing damage photo
 * (`DAMAGE`, no parent, `position` 1 to 15). Maps to `inspection_photos`. The picture itself lives in the file bucket (D50), under an id-based key,
 * never in the database.
 *
 * Evidence, so it is never edited: a retake replaces the file and counts in `retakeCount`; the server stamps `uploadedAt` and the
 * SHA-256 fingerprint, which the device cannot fake (spec pp. 9, 13).
 */
@Entity("inspection_photos")
// The same photo slot exists once: an upload that is retried (weak signal) finds its row instead of adding a second one. The slot is
// (inspection, shot, parent, number), with the parent read as '' when empty (an expression index TypeORM cannot describe, so it
// lives in the migration only: `synchronize: false`).
@Index("inspection_photos_slot_unique", { synchronize: false })
// A required shot has one photo (position 1); a close-up has a parent and is numbered 1 to 5; an old damage photo 1 to 15.
@Check(
  "inspection_photos_position_range",
  `("parent_shot_id" IS NULL AND "position" BETWEEN 1 AND 15 AND ("shot_id" = 'DAMAGE' OR "position" = 1)) OR ("parent_shot_id" IS NOT NULL AND "shot_id" = 'DAMAGE' AND "position" BETWEEN 1 AND 5)`,
)
@Check("inspection_photos_sha256_hex", `"sha256" ~ '^[0-9a-f]{64}$'`)
export class InspectionPhoto {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "inspection_id", type: "uuid" })
  inspectionId: string;

  /** `RESTRICT`: an inspection with photos cannot be deleted by accident. */
  @ManyToOne(() => Inspection, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "inspection_id" })
  inspection?: Inspection;

  /** A shot id from `inspection_shots`, or `DAMAGE`. Text, not a foreign key, because `DAMAGE` is not a row of that table. */
  @Column({ name: "shot_id", type: "varchar", length: 40 })
  shotId: string;

  @Column({ type: "smallint", default: 1 })
  position: number;

  /** For a damage close-up: the required shot it shows damage on. Null for a required shot and for old free-standing damage. */
  @Column({
    name: "parent_shot_id",
    type: "varchar",
    length: 40,
    nullable: true,
  })
  parentShotId: string | null;

  @ManyToOne(() => InspectionShot, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "parent_shot_id" })
  parentShot?: InspectionShot | null;

  /** Key of the picture in the bucket: `inspections/<inspectionId>/<NN>_<SHOT_ID>.jpg` (ids, not names). */
  @Column({ name: "storage_key", type: "varchar", length: 300 })
  storageKey: string;

  /** Key of the 400 px thumbnail. */
  @Column({ name: "thumb_key", type: "varchar", length: 300 })
  thumbKey: string;

  /** The time on the phone when the photo was taken; null if the phone sent none. A device value, so only informative. */
  @Column({ name: "captured_at", type: "timestamptz", nullable: true })
  capturedAt: Date | null;

  /** The server's time when the file arrived: the one to trust. */
  @CreateDateColumn({ name: "uploaded_at", type: "timestamptz" })
  uploadedAt: Date;

  /** The optional "+ Damage note", or the note under a damage photo. */
  @Column({ name: "driver_note", type: "varchar", length: 200, nullable: true })
  driverNote: string | null;

  /** SHA-256 (hex) of the file as received: shows later that the photo was not changed. */
  @Column({ type: "varchar", length: 64 })
  sha256: string;

  /** How many times the driver replaced this photo. */
  @Column({ name: "retake_count", type: "integer", default: 0 })
  retakeCount: number;

  /** Reserved for the Phase 2 AI comparison; always empty in v1. */
  @Column({ name: "ai_analysis", type: "jsonb", nullable: true })
  aiAnalysis: Record<string, unknown> | null;
}
