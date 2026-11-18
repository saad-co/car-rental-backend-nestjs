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
import { Contract } from "../contracts/contract.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";

/** Check-in = the driver picks the car up; check-out = the driver returns it (the client's meaning, MODULE3_SPEC section 1). */
export enum InspectionType {
  checkIn = "check_in",
  checkOut = "check_out",
}

/**
 * Where an inspection is. There is no `expired`: a link that ran out of time is worked out on read from
 * `tokenExpiresAt` (see `inspection-status.ts`), so nothing has to flip a column when the clock passes.
 * `reviewed` and `flagged` are for the staff review (chat 2) and are not set by anything in chat 1.
 */
export enum InspectionStatus {
  created = "created",
  linkSent = "link_sent",
  opened = "opened",
  inProgress = "in_progress",
  submitted = "submitted",
  reviewed = "reviewed",
  flagged = "flagged",
  revoked = "revoked",
}

/** The fuel levels of the capture page's fuel bar. The values are the keys of the client's translation file. */
export enum FuelLevel {
  empty = "empty",
  oneEighth = "1_8",
  oneQuarter = "1_4",
  threeEighths = "3_8",
  half = "1_2",
  fiveEighths = "5_8",
  threeQuarters = "3_4",
  sevenEighths = "7_8",
  full = "full",
}

/** Statuses in which the driver can still use the link: one such inspection per driver and type (see the index below). */
export const OPEN_INSPECTION_STATUSES = [
  InspectionStatus.created,
  InspectionStatus.linkSent,
  InspectionStatus.opened,
  InspectionStatus.inProgress,
] as const;

/** Statuses of a finished inspection (the driver submitted it). */
export const SUBMITTED_INSPECTION_STATUSES = [
  InspectionStatus.submitted,
  InspectionStatus.reviewed,
  InspectionStatus.flagged,
] as const;

/**
 * One vehicle check-in or check-out (Module 3, D102). Maps to the `inspections` table.
 *
 * The driver opens it from a texted link (`/i/<token>`, no login); only the SHA-256 hash of the token is stored, so a stolen
 * database cannot be used to open links. The vehicle (model, VIN, plate) is a copy made when the link is created: the contract
 * keeps its own text and the inspection must still show what was inspected if the contract changes.
 *
 * Mongo comparison: the document of one inspection, with the photos and the event log as their own collections (tables).
 */
@Entity("inspections")
// A link opens exactly one inspection; also what makes finding an inspection by token a fast index lookup.
@Index("inspections_token_hash_unique", ["tokenHash"], { unique: true })
@Index("inspections_reference_unique", ["reference"], { unique: true })
// At most one open inspection of each type per driver (the spec: one open session per type). The database refuses a second one
// even if two admins press "Send check-in link" at the same moment.
@Index("inspections_one_open_per_type", ["driverId", "type"], {
  unique: true,
  where: `"status" IN ('created', 'link_sent', 'opened', 'in_progress')`,
})
// The driver page lists a driver's inspections newest first.
@Index("inspections_driver_created_idx", ["driverId", "createdAt"])
// A submitted inspection has its time and the attestation; no code path or manual SQL can mark one submitted without them. The
// typed mileage and fuel level were required too until D112; now staff read both from the photos, so they are optional.
@Check(
  "inspections_submitted_shape",
  `("status" IN ('submitted', 'reviewed', 'flagged')) = ("submitted_at" IS NOT NULL) AND ("status" NOT IN ('submitted', 'reviewed', 'flagged') OR "attested_at" IS NOT NULL)`,
)
@Check("inspections_odometer_not_negative", `"odometer_miles" >= 0`)
export class Inspection {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** The number shown to the driver and on the page, `INS-2026-000123`, from a database sequence so it is never repeated. */
  @Column({ type: "varchar", length: 20 })
  reference: string;

  @Column({
    type: "enum",
    enum: InspectionType,
    enumName: "inspection_type",
  })
  type: InspectionType;

  @Column({
    type: "enum",
    enum: InspectionStatus,
    enumName: "inspection_status",
    default: InspectionStatus.created,
  })
  status: InspectionStatus;

  @Column({ name: "driver_id", type: "uuid" })
  driverId: string;

  /** `RESTRICT`: drivers are archived, never deleted, so an inspection (evidence) is never dropped with a driver row. */
  @ManyToOne(() => Driver, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver;

  /** The signed contract the vehicle was copied from; null when the admin typed the vehicle (a driver with no contract). */
  @Column({ name: "contract_id", type: "uuid", nullable: true })
  contractId: string | null;

  @ManyToOne(() => Contract, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "contract_id" })
  contract?: Contract | null;

  // The vehicle copy. The contract keeps one typed model text (no separate year and make, B140), shown as typed.
  @Column({ name: "vehicle_model", type: "varchar", length: 200 })
  vehicleModel: string;

  @Column({ name: "vehicle_vin", type: "varchar", length: 50, nullable: true })
  vehicleVin: string | null;

  @Column({
    name: "vehicle_plate",
    type: "varchar",
    length: 20,
    nullable: true,
  })
  vehiclePlate: string | null;

  /** On a check-out: the latest submitted check-in of the same driver and contract, so staff can compare them (chat 2). */
  @Column({ name: "paired_inspection_id", type: "uuid", nullable: true })
  pairedInspectionId: string | null;

  @ManyToOne(() => Inspection, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "paired_inspection_id" })
  pairedInspection?: Inspection | null;

  /** SHA-256 (hex) of the link's random token. The token itself is never stored, so a link cannot be shown again (D102). */
  @Column({ name: "token_hash", type: "varchar", length: 64 })
  tokenHash: string;

  /** When the link stops working: 72 hours or more (a setting, D112) after it was last sent or issued. A stored time; "expired" is worked out on read. */
  @Column({ name: "token_expires_at", type: "timestamptz" })
  tokenExpiresAt: Date;

  @Column({ name: "link_sent_at", type: "timestamptz", nullable: true })
  linkSentAt: Date | null;

  @Column({ name: "opened_at", type: "timestamptz", nullable: true })
  openedAt: Date | null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null;

  @Column({ name: "submitted_at", type: "timestamptz", nullable: true })
  submittedAt: Date | null;

  /** The mileage the driver typed from the odometer photo. */
  @Column({ name: "odometer_miles", type: "integer", nullable: true })
  odometerMiles: number | null;

  @Column({
    name: "fuel_level",
    type: "enum",
    enum: FuelLevel,
    enumName: "inspection_fuel_level",
    nullable: true,
  })
  fuelLevel: FuelLevel | null;

  /** Where the phone was, if it already allowed location (never asked for). Degrees. */
  @Column({ name: "gps_lat", type: "double precision", nullable: true })
  gpsLat: number | null;

  @Column({ name: "gps_lng", type: "double precision", nullable: true })
  gpsLng: number | null;

  /** The browser and phone, as the browser reports them, for disputes. */
  @Column({ name: "device_info", type: "varchar", length: 500, nullable: true })
  deviceInfo: string | null;

  /** When the driver ticked "These photos show the car's condition right now" and submitted. No typed name (spec p. 4). */
  @Column({ name: "attested_at", type: "timestamptz", nullable: true })
  attestedAt: Date | null;

  // Filled by the staff review (chat 2); nothing in chat 1 writes them.
  @Column({ name: "reviewed_by_id", type: "uuid", nullable: true })
  reviewedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "reviewed_by_id" })
  reviewedBy?: User | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt: Date | null;

  @Column({ name: "review_notes", type: "text", nullable: true })
  reviewNotes: string | null;

  /** The admin who made the link. Null only if that account was removed later: the inspection stays. */
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
