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
import { ContractSchedule } from "../contracts/contract.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";

/**
 * The daily or weekly rent of a driver who has no signed contract, set by hand by an admin (D100, Saad's request for the
 * drivers added by hand). Maps to `driver_recurring_charges`.
 *
 * It is the other half of "the rent a driver is billed": the database view `billable_contracts` lists the signed contracts and
 * these rows in one shape, so the rent job, the dashboard, daily operations and the reminders all read the same thing. A row
 * is never edited: a later change is a new row that takes over on its own date (the same hand-over as a newer contract).
 *
 * Money is integer cents (spec rule 1); every date is a Chicago day (rule 4).
 */
@Entity("driver_recurring_charges")
// A driver cannot have two charges that start the same day (the rent keys would collide).
@Index(
  "driver_recurring_charges_driver_first_due",
  ["driverId", "firstDueDate"],
  {
    unique: true,
  },
)
// Refused by the database even if the code had a bug: a charge is a positive amount of cents.
@Check("driver_recurring_charges_amount_positive", `"amount_cents" > 0`)
export class RecurringCharge {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "driver_id", type: "uuid" })
  driverId: string;

  /** `RESTRICT`: drivers are archived, never deleted, so a driver's charge is never silently dropped with the row. */
  @ManyToOne(() => Driver, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "driver_id" })
  driver?: Driver;

  /** How often the driver pays: the same type a contract uses. */
  @Column({
    type: "enum",
    enum: ContractSchedule,
    enumName: "contract_schedule",
  })
  schedule: ContractSchedule;

  /** The rent of one period in whole cents. */
  @Column({ name: "amount_cents", type: "integer" })
  amountCents: number;

  /** The first rent due date, `YYYY-MM-DD` (never before the day it was saved, see `firstRentDate`). */
  @Column({ name: "first_due_date", type: "date" })
  firstDueDate: string;

  /** The admin who set it. Null only if that account was removed later: the charge stays. */
  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy?: User | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
