import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * One of the required photos of an inspection (spec section 5), kept as a table so GonzoCar can add or reorder shots later
 * without a code change. Maps to `inspection_shots`; the migration seeds the 19 shots. The same list is used for check-in and
 * check-out, so every check-out photo has a check-in twin. 21 shots since D112 (the two side mirrors added).
 *
 * The words shown to the driver (title, instruction) come from the client's translation file on the capture page, in both
 * languages; `title` and `instruction` here are the English text, for staff and for reading the table.
 */
@Entity("inspection_shots")
// The order of the walk-around; two shots can never share a place.
@Index("inspection_shots_position_unique", ["position"], { unique: true })
export class InspectionShot {
  /** The client's id, e.g. `EXT_DRIVER_SIDE`. */
  @PrimaryColumn({ name: "shot_id", type: "varchar", length: 40 })
  shotId: string;

  /** 1 to 21, the order the driver is guided in. */
  @Column({ type: "smallint" })
  position: number;

  @Column({ type: "varchar", length: 100 })
  title: string;

  @Column({ type: "text" })
  instruction: string;

  /** The framing outline drawn on the live camera; empty until the client sends artwork (B138). */
  @Column({
    name: "overlay_image",
    type: "varchar",
    length: 200,
    nullable: true,
  })
  overlayImage: string | null;

  /** A shot that must be present before the inspection can be submitted. */
  @Column({ type: "boolean", default: true })
  required: boolean;
}
