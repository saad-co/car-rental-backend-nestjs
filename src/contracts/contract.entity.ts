import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";
import { ContractCompany } from "./contract-company.entity.js";

/**
 * Where a contract is. `draft` is being typed; `sent` went to the driver through firma (step 3). Signed, viewed, declined and
 * expired come with step 4, which adds values to this enum with its own migration.
 */
export enum ContractStatus {
  draft = "draft",
  sent = "sent",
}

/**
 * The frozen copy of what was sent (step 3): the template file, who it went to, and every value as printed on the PDF.
 * Holds the licence number and date of birth as plain text (B94): keep it out of lists and logs.
 */
export interface ContractSentValues {
  template: string;
  recipientName: string;
  recipientEmail: string;
  values: Record<string, string>;
}

/** How often the driver pays the rate. */
export enum ContractSchedule {
  weekly = "weekly",
  daily = "daily",
}

/** The largest rate or charge: $10,000 in cents (the same cap as a manual ledger entry). */
export const MAX_CONTRACT_CENTS = 1_000_000;

/** Term in months: at least 1, at most 60 (5 years). The client's contracts run 18. */
export const MIN_TERM_MONTHS = 1;
export const MAX_TERM_MONTHS = 60;
export const DEFAULT_TERM_MONTHS = 18;

/**
 * A driver's lease contract (Module 2). In step 1 it is only a draft holding what the admin typed; the calculated numbers
 * (rate breakdown, totals, end date) are never stored, they are worked out from these inputs by `contract-math.ts`
 * (D71). They get frozen when the contract is sent for signing (step 3). Maps to the `contracts` table.
 */
@Entity("contracts")
// A driver has at most one draft. The database refuses a second one, so a double click or two admins at once can never
// make two (the partial index only covers drafts: later, signed contracts pile up per driver without limit).
@Index("contracts_one_draft_per_driver", ["driverId"], {
  unique: true,
  where: `"status" = 'draft'`,
})
@Check(
  "contracts_total_rate_range",
  `"total_rate_cents" BETWEEN 1 AND ${MAX_CONTRACT_CENTS}`,
)
@Check(
  "contracts_charges_range",
  `"security_deposit_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}
    AND "documentation_fee_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}
    AND "insurance_start_fee_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}
    AND "other_one_time_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}
    AND "hold_vehicle_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}
    AND "excess_mileage_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}
    AND "insurance_excess_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}
    AND "other_recurring_cents" BETWEEN 0 AND ${MAX_CONTRACT_CENTS}`,
)
@Check(
  "contracts_term_range",
  `"term_months" BETWEEN ${MIN_TERM_MONTHS} AND ${MAX_TERM_MONTHS}`,
)
// Sending leaves all of its marks together or none: a draft has no sent data, anything else has all of it. Written on
// columns and on 'draft' only: a CHECK cannot name a value added to the enum in the same migration.
@Check(
  "contracts_sent_shape",
  `("status" = 'draft') = ("sent_at" IS NULL)
    AND ("sent_at" IS NULL) = ("firma_signing_request_id" IS NULL)
    AND ("sent_at" IS NULL) = ("sent_values" IS NULL)`,
)
// One firma envelope belongs to one contract.
@Index("contracts_firma_signing_request_id", ["firmaSigningRequestId"], {
  unique: true,
  where: `"firma_signing_request_id" IS NOT NULL`,
})
export class Contract {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** The driver this contract is for. A driver with contracts cannot be deleted (RESTRICT), they are records. */
  @Column({ name: "driver_id", type: "uuid" })
  driverId: string;

  @ManyToOne(() => Driver, { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver;

  @Column({
    type: "enum",
    enum: ContractStatus,
    enumName: "contract_status",
    default: ContractStatus.draft,
  })
  status: ContractStatus;

  @Column({
    type: "enum",
    enum: ContractSchedule,
    enumName: "contract_schedule",
  })
  schedule: ContractSchedule;

  /** The weekly or daily rate in whole cents (spec rule 1): the one typed number the disclosure is calculated from. */
  @Column({ name: "total_rate_cents", type: "integer" })
  totalRateCents: number;

  /** First day of the term, a plain calendar day (no time zone). */
  @Column({ name: "start_date", type: "date" })
  startDate: string;

  @Column({
    name: "term_months",
    type: "smallint",
    default: DEFAULT_TERM_MONTHS,
  })
  termMonths: number;

  // One-time charges, due at pickup. Whole cents, 0 when not charged.
  @Column({ name: "security_deposit_cents", type: "integer", default: 0 })
  securityDepositCents: number;

  @Column({ name: "documentation_fee_cents", type: "integer", default: 0 })
  documentationFeeCents: number;

  @Column({ name: "insurance_start_fee_cents", type: "integer", default: 0 })
  insuranceStartFeeCents: number;

  @Column({ name: "other_one_time_cents", type: "integer", default: 0 })
  otherOneTimeCents: number;

  @Column({ name: "hold_vehicle_cents", type: "integer", default: 0 })
  holdVehicleCents: number;

  // Recurring charges on top of the rate. Whole cents, 0 when not charged.
  /** Excess mileage, in cents per mile. */
  @Column({ name: "excess_mileage_cents", type: "integer", default: 0 })
  excessMileageCents: number;

  /** Insurance excess, in cents per month. */
  @Column({ name: "insurance_excess_cents", type: "integer", default: 0 })
  insuranceExcessCents: number;

  @Column({ name: "other_recurring_cents", type: "integer", default: 0 })
  otherRecurringCents: number;

  // Step 2 details. All optional: a draft can be saved before they are known, and nothing here is checked beyond a length
  // limit (the client asked for the values, not for rules about them).

  /** The Lessor, from the fixed company list; its name is printed as the company's signature (D72). */
  @Column({ name: "company_id", type: "uuid", nullable: true })
  companyId: string | null;

  @ManyToOne(() => ContractCompany, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "company_id" })
  company?: ContractCompany | null;

  @Column({
    name: "vehicle_model",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  vehicleModel: string | null;

  @Column({ name: "vehicle_vin", type: "varchar", length: 50, nullable: true })
  vehicleVin: string | null;

  @Column({
    name: "vehicle_plate",
    type: "varchar",
    length: 20,
    nullable: true,
  })
  vehiclePlate: string | null;

  /** The state the plate is from, as typed ("IL" or "Illinois"). */
  @Column({
    name: "vehicle_plate_state",
    type: "varchar",
    length: 50,
    nullable: true,
  })
  vehiclePlateState: string | null;

  /** Purchase option price (section 15 of the sample contracts) in whole cents. */
  @Column({ name: "purchase_option_cents", type: "integer", nullable: true })
  purchaseOptionCents: number | null;

  /** The driver's address on one line, as typed. */
  @Column({
    name: "lessee_address",
    type: "varchar",
    length: 300,
    nullable: true,
  })
  lesseeAddress: string | null;

  /** Sensitive (B94: to be encrypted). Never in a list response or a log line. */
  @Column({
    name: "license_number",
    type: "varchar",
    length: 50,
    nullable: true,
  })
  licenseNumber: string | null;

  @Column({
    name: "license_state",
    type: "varchar",
    length: 50,
    nullable: true,
  })
  licenseState: string | null;

  /** Sensitive (B94: to be encrypted). A plain calendar day. Never in a list response or a log line. */
  @Column({ name: "date_of_birth", type: "date", nullable: true })
  dateOfBirth: string | null;

  // Step 3: set together when the contract is sent to firma, null before.

  @Column({ name: "sent_at", type: "timestamptz", nullable: true })
  sentAt: Date | null;

  /** The admin who clicked Send; null before, or if that account was removed. */
  @Column({ name: "sent_by_id", type: "uuid", nullable: true })
  sentById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "sent_by_id" })
  sentBy?: User | null;

  /** firma's id of the signing request (one envelope per contract). */
  @Column({
    name: "firma_signing_request_id",
    type: "varchar",
    length: 100,
    nullable: true,
  })
  firmaSigningRequestId: string | null;

  /** The frozen copy of what was sent. Sensitive (B94). */
  @Column({ name: "sent_values", type: "jsonb", nullable: true })
  sentValues: ContractSentValues | null;

  /** The admin who made the draft; null if that account was removed. */
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  /** The admin who last saved it; null if that account was removed. */
  @Column({ name: "updated_by_id", type: "uuid", nullable: true })
  updatedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "updated_by_id" })
  updatedBy?: User | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
