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
import { MAX_MANUAL_ENTRY_CENTS } from "../ledger/dto/ledger-entry.dto.js";
import { User } from "../users/user.entity.js";

/** Which kind of manual entry a preset is for: a charge (debit) or a credit. */
export enum LedgerPresetKind {
  charge = "charge",
  credit = "credit",
}

/** Longest preset name (the card's title). */
export const MAX_PRESET_NAME_LENGTH = 60;

/** Longest preset description (the ledger line's text; the same limit as an entry's description). */
export const MAX_PRESET_DESCRIPTION_LENGTH = 500;

/**
 * A quick-pick card in the "New ledger entry" window (B86, D66): clicking it fills the description, and the amount when
 * the preset has one. Admins keep the list in Settings. Maps to the `ledger_presets` table; the migration inserts the
 * client's starting list.
 *
 * Nothing about a preset is stored on a ledger entry (D61): the text and amount are copied into the entry when it is
 * made, so editing or deleting a preset never changes an old entry.
 */
@Entity("ledger_presets")
// Two presets of a kind cannot share a name, or the window would show two identical cards.
@Unique("ledger_presets_kind_name", ["kind", "name"])
@Check("ledger_presets_name_not_blank", `length(btrim("name")) >= 1`)
@Check(
  "ledger_presets_description_length",
  `length(btrim("description")) BETWEEN 1 AND ${MAX_PRESET_DESCRIPTION_LENGTH}`,
)
// The same cap as a manual entry, so a preset can never fill in an amount the API would refuse.
@Check(
  "ledger_presets_amount_range",
  `"amount_cents" IS NULL OR ("amount_cents" >= 1 AND "amount_cents" <= ${MAX_MANUAL_ENTRY_CENTS})`,
)
export class LedgerPreset {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    type: "enum",
    enum: LedgerPresetKind,
    enumName: "ledger_preset_kind",
  })
  kind: LedgerPresetKind;

  /** The card's title, e.g. "Late fee". */
  @Column({ type: "varchar", length: MAX_PRESET_NAME_LENGTH })
  name: string;

  /** The default amount in whole cents (spec rule 1), or null for "enter amount". */
  @Column({ name: "amount_cents", type: "integer", nullable: true })
  amountCents: number | null;

  /** What the Description box is filled with, e.g. "Late payment fee". */
  @Column({ type: "varchar", length: MAX_PRESET_DESCRIPTION_LENGTH })
  description: string;

  /** The order of the cards within a kind, from 1. */
  @Column({ type: "integer" })
  position: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  /** The admin who last edited it; null for the starting list, or if that account was removed. */
  @Column({ name: "updated_by_id", type: "uuid", nullable: true })
  updatedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "updated_by_id" })
  updatedBy?: User | null;
}
