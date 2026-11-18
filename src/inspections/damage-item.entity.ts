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
import { LedgerEntry } from "../ledger/ledger-entry.entity.js";
import { User } from "../users/user.entity.js";
import { InspectionPhoto } from "./inspection-photo.entity.js";
import { Inspection } from "./inspection.entity.js";

/**
 * Where a damage item is: `new_during_rental` = staff compared the check-out with the check-in and found damage that was not
 * there at pickup; `charged` = a ledger charge was made for it. (The spec also lists `pre_existing`, `disputed` and `repaired`;
 * pre-existing damage is read from the check-in's own damage photos and never stored, and nothing sets the other two, D110.)
 */
export enum DamageItemStatus {
  newDuringRental = "new_during_rental",
  charged = "charged",
}

/**
 * Damage staff found by comparing a check-out with its check-in (Module 3 chat 2, D110). Maps to `damage_items`.
 * One row per check-out photo that shows new damage: either one of the 19 shots (staff compared it with the check-in's) or a
 * damage close-up the driver added at return. The photo says where on the car; the description says what.
 */
@Entity("damage_items")
// One item per photo: pressing "New damage" twice makes one.
@Index("damage_items_photo_unique", ["photoId"], { unique: true })
// A charge belongs to one item and an item has one charge.
@Index("damage_items_ledger_entry_unique", ["ledgerEntryId"], {
  unique: true,
  where: `"ledger_entry_id" IS NOT NULL`,
})
@Index("damage_items_inspection_idx", ["inspectionId"])
@Check(
  "damage_items_description_not_blank",
  `length(btrim("description")) BETWEEN 1 AND 500`,
)
@Check(
  "damage_items_charged_iff_entry",
  `("status" = 'charged') = ("ledger_entry_id" IS NOT NULL)`,
)
export class DamageItem {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** The check-out this was found on. */
  @Column({ name: "inspection_id", type: "uuid" })
  inspectionId: string;

  @ManyToOne(() => Inspection, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "inspection_id" })
  inspection?: Inspection;

  /** The check-out photo that shows it. */
  @Column({ name: "photo_id", type: "uuid" })
  photoId: string;

  @ManyToOne(() => InspectionPhoto, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "photo_id" })
  photo?: InspectionPhoto;

  /** What the damage is, in staff's words, 1 to 500 characters. */
  @Column({ type: "varchar", length: 500 })
  description: string;

  @Column({
    type: "enum",
    enum: DamageItemStatus,
    enumName: "damage_item_status",
    default: DamageItemStatus.newDuringRental,
  })
  status: DamageItemStatus;

  /** The ledger charge made for it; set together with `status = charged`. */
  @Column({ name: "ledger_entry_id", type: "uuid", nullable: true })
  ledgerEntryId: string | null;

  @ManyToOne(() => LedgerEntry, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "ledger_entry_id" })
  ledgerEntry?: LedgerEntry | null;

  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
