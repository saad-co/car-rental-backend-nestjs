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

/**
 * Where a contract is. Only `draft` exists in step 1 (Module 2); sending, signing and the rest come with steps 3 and 4,
 * which add values to this enum with their own migrations.
 */
export enum ContractStatus {
  draft = "draft",
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
