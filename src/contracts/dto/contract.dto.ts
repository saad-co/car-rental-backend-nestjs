import { applyDecorators } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  Matches,
  Max,
  Min,
  registerDecorator,
  type ValidationOptions,
} from "class-validator";
import { isCalendarDate } from "../../common/chicago-date.js";
import {
  ContractSchedule,
  ContractStatus,
  MAX_CONTRACT_CENTS,
  MAX_TERM_MONTHS,
  MIN_TERM_MONTHS,
} from "../contract.entity.js";

/** The value is a real calendar day written `YYYY-MM-DD` (refuses `2026-02-30`). */
function IsCalendarDay(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: "isCalendarDay",
      target: target.constructor,
      propertyName: propertyKey as string,
      options: {
        message: "The start date must be a real day, written YYYY-MM-DD.",
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === "string" && isCalendarDate(value),
      },
    });
  };
}

/** A charge: whole cents, from $0 to $10,000. */
function Charge(): PropertyDecorator {
  return applyDecorators(
    IsInt({ message: "Charges must be a whole number of cents." }),
    Min(0, { message: "A charge cannot be negative." }),
    Max(MAX_CONTRACT_CENTS, { message: "A charge can be at most $10,000." }),
  );
}

/**
 * Body of `POST /contracts/calculate`, `POST /drivers/:driverId/contracts` and `PUT /contracts/:id`: everything the admin
 * types for a contract (D71). All money is whole cents (spec rule 1). A PUT replaces all of it, so every field is
 * required; send 0 for a charge that does not apply.
 */
export class ContractInputDto {
  /** How often the driver pays: weekly or daily. */
  @ApiProperty({ enum: ContractSchedule, enumName: "ContractSchedule" })
  @IsEnum(ContractSchedule, { message: "Choose weekly or daily." })
  schedule: ContractSchedule;

  /** The weekly or daily rate in cents, 1 to 1,000,000 ($10,000): the one number the disclosure is calculated from. */
  @IsInt({ message: "The total rate must be a whole number of cents." })
  @Min(1, { message: "The total rate must be more than $0." })
  @Max(MAX_CONTRACT_CENTS, {
    message: "The total rate can be at most $10,000.",
  })
  totalRateCents: number;

  /** First day of the term, a real day written `YYYY-MM-DD`. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "The date must be YYYY-MM-DD." })
  @IsCalendarDay()
  startDate: string;

  /** Length of the term in months, 1 to 60 (the client's contracts use 18). */
  @IsInt({ message: "The term must be a whole number of months." })
  @Min(MIN_TERM_MONTHS, { message: "The term must be at least 1 month." })
  @Max(MAX_TERM_MONTHS, { message: "The term can be at most 60 months." })
  termMonths: number;

  /** One-time charge: security deposit, cents (0 to 1,000,000). */
  @Charge()
  securityDepositCents: number;

  /** One-time charge: documentation fee, cents. */
  @Charge()
  documentationFeeCents: number;

  /** One-time charge: insurance policy start fee, cents. */
  @Charge()
  insuranceStartFeeCents: number;

  /** One-time charge: other, cents. */
  @Charge()
  otherOneTimeCents: number;

  /** One-time charge: hold vehicle payment, cents. */
  @Charge()
  holdVehicleCents: number;

  /** Recurring charge: excess mileage, cents per mile. */
  @Charge()
  excessMileageCents: number;

  /** Recurring charge: insurance excess, cents per month. */
  @Charge()
  insuranceExcessCents: number;

  /** Recurring charge: other, cents. */
  @Charge()
  otherRecurringCents: number;
}

/** The numbers worked out from the inputs (D71); never stored, always recalculated. All money in whole cents. */
export class ContractNumbersDto {
  /** Base rate (42% of the total, plus any rounding remainder). */
  baseCents: number;
  /** Insurance (30%). */
  insuranceCents: number;
  /** Unlimited miles package (13%). */
  milesCents: number;
  /** Full maintenance package (10%). */
  maintenanceCents: number;
  /** Taxes (5%). */
  taxCents: number;
  /** The weekly or daily payment: equal to the total rate. */
  paymentCents: number;
  /** The sum of the five one-time charges. */
  oneTimeTotalCents: number;
  /** First payment + one-time charges. */
  amountDueAtPickupCents: number;
  /** Payment + excess mileage + insurance excess + other recurring (the sheet's recurring Total row). */
  recurringTotalCents: number;
  /** Last day of the term, `YYYY-MM-DD` (start date + term months, clamped to the month's last day). */
  endDate: string;
}

/** A saved contract draft: what was typed, the numbers calculated from it, and its bookkeeping. */
export class ContractDto extends ContractInputDto {
  id: string;
  driverId: string;
  @ApiProperty({ enum: ContractStatus, enumName: "ContractStatus" })
  status: ContractStatus;
  /** Recalculated from the inputs on every read (D71). */
  numbers: ContractNumbersDto;
  createdAt: Date;
  updatedAt: Date;
}

/** Response of `GET /drivers/:driverId/contract-draft`. */
export class ContractDraftDto {
  /** The driver's draft, or null when there is none. */
  @ApiProperty({ type: () => ContractDto, nullable: true })
  draft: ContractDto | null;
}
