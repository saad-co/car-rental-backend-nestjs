import { ApiProperty } from "@nestjs/swagger";
import { ContractSchedule } from "../../contracts/contract.entity.js";
import {
  DEACTIVATION_REASONS,
  type DeactivationReason,
  type DueStatus,
} from "../daily-ops.js";
import { DriverLeftReason, DriverStatus } from "../../drivers/driver.entity.js";

/**
 * The daily operations page (Dashboard page 1, D92). Every figure is worked out on the server when the page is read, from
 * the ledger and the signed contract: money in integer cents (spec rule 1), days as Chicago `YYYY-MM-DD` days (rule 4).
 * Nothing here is stored. The rows are plain objects so a later field (a late fee, an override) is an additive change.
 */

/** A payment due today (D1). */
export class DueTodayRowDto {
  driverId: string;
  name: string;
  /** The vehicle of the contract in force, "Model (PLATE)"; null when the contract names none. */
  vehicle: string | null;
  /** Weekly or daily, from the contract in force; null if the driver has none (not expected: rent comes from a contract). */
  @ApiProperty({
    enum: ContractSchedule,
    enumName: "ContractSchedule",
    nullable: true,
  })
  schedule: ContractSchedule | null;
  /** The contract's rent per period in cents; null without a contract. */
  rateCents: number | null;
  /** The time rent is due, Chicago `HH:MM` (24 hours); null = not set (late when the due day ends). */
  dueTime: string | null;
  /** The rent charge due today, in cents. */
  amountDueCents: number;
  /** What is still unpaid of it after credits are applied oldest first; 0 = paid. */
  openCents: number;
  /** Paid: nothing open. Late: open and past the due time. Not yet paid: open, due time not reached. */
  @ApiProperty({ enum: ["paid", "not_yet_paid", "late"] })
  status: DueStatus;
  /** Staff marked the driver "On Payment Plan". */
  onPaymentPlan: boolean;
}

/** A driver with late rent: the row of the Late payments and Early Warning lists (D2, D3). */
export class LateDriverDto {
  driverId: string;
  name: string;
  /** Rate type: weekly or daily, from the contract in force. */
  @ApiProperty({
    enum: ContractSchedule,
    enumName: "ContractSchedule",
    nullable: true,
  })
  schedule: ContractSchedule | null;
  /** The time rent is due, Chicago `HH:MM`; null = not set. */
  dueTime: string | null;
  /** The unpaid part of every late rent charge added up, in cents. */
  pastDueCents: number;
  /** How many rent charges are late. */
  lateCount: number;
  /** Whole days the oldest late charge is late, counted on the Chicago clock (1 = the same time on the next day has come). */
  daysLate: number;
  /** Real hours since the oldest late charge was due. */
  hoursLate: number;
  /** Staff marked the driver "On Payment Plan". */
  onPaymentPlan: boolean;
}

/** A driver on the Should Be Deactivated list (D4). The list only shows; it never changes a driver. */
export class ShouldBeDeactivatedRowDto {
  driverId: string;
  name: string;
  /** Weekly or daily, from the contract in force; null if the driver has none. */
  @ApiProperty({
    enum: ContractSchedule,
    enumName: "ContractSchedule",
    nullable: true,
  })
  schedule: ContractSchedule | null;
  /** Active, or onboarding (an unpaid deposit puts a driver who is still onboarding on the list). */
  @ApiProperty({ enum: DriverStatus, enumName: "DriverStatus" })
  driverStatus: DriverStatus;
  /**
   * Why: `daily_late` (2 or more daily payments late), `weekly_late` (a weekly payment 2 days late), `deposit_unpaid`
   * (deposit still unpaid 7 days after its due date). At least one; the rows can show several.
   */
  @ApiProperty({ enum: DEACTIVATION_REASONS, isArray: true })
  reasons: DeactivationReason[];
  /** Ledger balance in cents: credits minus debits; negative = the driver owes. */
  balanceCents: number;
  /** Whole days the oldest late rent payment is late (Chicago clock); 0 when the reason is the deposit only. */
  daysLate: number;
  /** Days since the unpaid deposit was due (the contract start date); null when the deposit is not what is unpaid. */
  depositDaysSinceDue: number | null;
  /** The unpaid deposit in cents; null when the deposit is not what is unpaid. */
  depositCents: number | null;
}

/** One Monday-to-Sunday week of collected money (D5). */
export class WeekTotalDto {
  /** The Monday, Chicago day `YYYY-MM-DD`. */
  weekStart: string;
  /** The Sunday, Chicago day `YYYY-MM-DD`. */
  weekEnd: string;
  /** Confirmed payments that came in that week, in cents; 0 for a quiet week. */
  totalCents: number;
  paymentCount: number;
}

/** A driver whose deposit step is ticked (D6). */
export class DepositCollectedRowDto {
  driverId: string;
  name: string;
  /** The amount typed when the step was ticked (D82), in cents; null for a step ticked before amounts were recorded. */
  amountCents: number | null;
  /** When the step was ticked. */
  paidAt: Date;
}

/** Deposits collected (D6). Ticking the step does not touch the ledger (B106): this is the record, not a ledger sum. */
export class DepositsCollectedDto {
  /** The recorded amounts added up, in cents. */
  totalCents: number;
  /** How many drivers have no amount recorded; they are in the list and not in the total. */
  withoutAmountCount: number;
  /** Newest first. */
  drivers: DepositCollectedRowDto[];
}

/** A driver whose contract asks for a deposit that is not ticked yet (D7). */
export class DepositPendingRowDto {
  driverId: string;
  name: string;
  /** The deposit the signed contract asks for, in cents. */
  amountCents: number;
  /** The day it is due: the contract start date, `YYYY-MM-DD`. */
  dueDate: string;
  /** Days since the due date; negative before it. */
  daysSinceDue: number;
  /** 7 or more days since the due date: the driver is also on the Should Be Deactivated list (unless on a payment plan). */
  overdue: boolean;
  onPaymentPlan: boolean;
}

/** Deposits drivers still owe (D7): the contract has a deposit and the "Deposit paid" step is not ticked. */
export class DepositsPendingDto {
  totalCents: number;
  /** Longest overdue first. */
  drivers: DepositPendingRowDto[];
}

/** A driver in collections (D9: the existing Collections feature, D81). */
export class CollectionsRowDto {
  driverId: string;
  name: string;
  /** Ledger balance in cents: credits minus debits; negative = the driver owes. */
  balanceCents: number;
  /** When an admin sent the driver to collections. */
  sentToCollectionsAt: Date;
  /** How the driver left (D81); null for a driver deactivated before reasons existed. */
  @ApiProperty({
    enum: DriverLeftReason,
    enumName: "DriverLeftReason",
    nullable: true,
  })
  leftReason: DriverLeftReason | null;
}

/** Drivers in collections, most owed first. */
export class CollectionsDto {
  /** What is owed by the drivers in the list (only the ones with a negative balance count), in cents. */
  totalOwedCents: number;
  drivers: CollectionsRowDto[];
}

/** Everything the daily operations page shows. */
export class DailyOperationsDto {
  /** When the figures were worked out. */
  asOf: Date;
  /** Today's Chicago day, `YYYY-MM-DD`. */
  today: string;
  /** Payments due today: weekly drivers first, then daily, then by name. */
  dueToday: DueTodayRowDto[];
  /** Drivers with a late rent payment, the longest late first. */
  late: LateDriverDto[];
  /** Drivers whose oldest late payment is a full day or more late, the longest late first. */
  earlyWarning: LateDriverDto[];
  /** Drivers who meet a deactivation rule and are not on a payment plan, the longest overdue first. List only. */
  shouldBeDeactivated: ShouldBeDeactivatedRowDto[];
  /** The current week and the 25 before it, newest first (D5). Monday to Sunday, Chicago days. */
  weeks: WeekTotalDto[];
  depositsCollected: DepositsCollectedDto;
  depositsPending: DepositsPendingDto;
  collections: CollectionsDto;
}
