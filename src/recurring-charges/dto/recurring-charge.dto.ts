import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsInt, IsISO8601, Max, Min } from "class-validator";
import { ContractSchedule } from "../../contracts/contract.entity.js";

/** The largest amount a Postgres `integer` column holds, in cents (about $21 million): the only upper limit, no business cap. */
const MAX_CENTS = 2_147_483_647;

/** Where a rent change is: not started yet, the one in force today, or an earlier one that a later change took over from. */
export type RecurringChargeStatus = "pending" | "current" | "past";

/**
 * Body of `POST /drivers/:id/recurring-charge` (D100, D101): "rent from a date". It sets the first rent of a driver with no
 * contract, or changes the rent of any driver (a charge set by hand or a signed contract).
 */
export class CreateRecurringChargeDto {
  /** `weekly` or `daily`: how often the driver pays the amount. */
  @IsEnum(ContractSchedule)
  schedule: ContractSchedule;

  /** The rent of one period in whole cents (`40900` = $409.00): a whole number above zero, never a decimal. */
  @IsInt()
  @Min(1, { message: "amountCents must be above zero" })
  @Max(MAX_CENTS)
  amountCents: number;

  /**
   * `YYYY-MM-DD`, the day the new rent is "from". A weekly rent is due on this day's weekday. The first rent is the first due
   * day on or after the latest of this date, today and the day after the last rent already posted, so nothing in the past is
   * ever billed and a day that already has its rent is never billed twice.
   */
  @IsISO8601({ strict: true }, { message: "startDate must be a real date" })
  startDate: string;
}

/** One rent set by hand, as the driver page shows it. */
export class RecurringChargeDto {
  id: string;
  schedule: ContractSchedule;
  amountCents: number;
  /** The first rent due date, `YYYY-MM-DD`: the day this rent starts billing. */
  firstDueDate: string;
  /** `pending`: not started yet (can still be replaced or removed). `current`: in force today. `past`: taken over by a later one. */
  @ApiProperty({ enum: ["pending", "current", "past"] })
  status: RecurringChargeStatus;
  createdAt: Date;
  /** The admin who set it; null if that account was removed since. */
  createdByEmail: string | null;
}

/** `GET /drivers/:id/recurring-charge`: the rent set by hand. */
export class DriverRecurringChargeDto {
  /** The rent set by hand in force today, or the next one waiting to start; `null` when none was ever set. */
  charge: RecurringChargeDto | null;
  /** Every rent set by hand, newest first, with where each one is. Empty when none was ever set. */
  changes: RecurringChargeDto[];
}
