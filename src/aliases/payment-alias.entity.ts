import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { AliasType } from "./normalize-alias.js";

/** Where an alias came from. */
export enum AliasSource {
  /** Imported from the old system (B42). */
  legacy = "legacy",
  /** Entered or confirmed by an admin (e.g. by assigning a payment). */
  manual = "manual",
  /** Learned from a very confident AI match (D48). */
  ai_match = "ai_match",
}

/**
 * A payment identity that belongs to one driver (spec 4, client B52): a name, handle, company name or family
 * member they pay from, per payment method. Maps to `payment_aliases`.
 *
 * Lookups ALWAYS filter by `type`: a Venmo handle must never match a Zelle payment (reference defect 1).
 */
@Entity("payment_aliases")
// One alias, one driver: the same name under the same method can never point at two drivers.
@Unique("payment_aliases_type_value_key", ["type", "valueNormalized"])
@Index("payment_aliases_driver_idx", ["driverId"])
export class PaymentAlias {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "driver_id", type: "uuid" })
  driverId: string;

  @ManyToOne(() => Driver, { onDelete: "CASCADE" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver;

  @Column({ type: "enum", enum: AliasType, enumName: "alias_type" })
  type: AliasType;

  /** As entered or as the provider wrote it, for display. */
  @Column({ type: "varchar", length: 255 })
  value: string;

  /** `normalizeAliasValue(type, value)`: what lookups compare. */
  @Column({ name: "value_normalized", type: "varchar", length: 255 })
  valueNormalized: string;

  @Column({ type: "enum", enum: AliasSource, enumName: "alias_source" })
  source: AliasSource;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
