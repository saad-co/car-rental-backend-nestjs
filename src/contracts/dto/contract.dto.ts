import { applyDecorators } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
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
 * A text detail of the contract (step 2): optional, trimmed, and an empty box is stored as nothing. The only rule is the
 * length limit of its column; the client did not ask for a format.
 */
function OptionalText(maxLength: number): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ type: String, nullable: true, required: false }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === "string" ? value.trim() || null : value,
    ),
    IsOptional(),
    IsString({ message: "This must be text." }),
    MaxLength(maxLength, {
      message: `This can be at most ${maxLength} characters.`,
    }),
  );
}

/** The largest value of the `integer` column that holds the purchase option price (about $21 million). */
const MAX_INTEGER_CENTS = 2_147_483_647;

/**
 * Body of `POST /contracts/calculate`: the numbers the contract's calculation is made from (D71). This is also the first
 * half of a saved draft's body (`ContractInputDto`). All money is whole cents (spec rule 1). The calculate route takes
 * only these fields, because unknown fields are refused.
 */
export class ContractNumbersInputDto {
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

/**
 * Body of `POST /drivers/:driverId/contracts` and `PUT /contracts/:id`: the numbers (D71) and the details of step 2. A PUT
 * replaces all of it: a detail that is left out or empty is cleared. Nothing is required; completeness is checked when
 * the contract is sent (step 3).
 */
export class ContractInputDto extends ContractNumbersInputDto {
  /** The Lessor: the id of a company from `GET /contracts/companies`. */
  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsUUID(undefined, { message: "Choose a company from the list." })
  companyId?: string | null;

  /** Vehicle model, as typed. */
  @OptionalText(100)
  vehicleModel?: string | null;

  /** Vehicle identification number, as typed. */
  @OptionalText(50)
  vehicleVin?: string | null;

  /** Licence plate, as typed. */
  @OptionalText(20)
  vehiclePlate?: string | null;

  /** The state the plate is from, as typed. */
  @OptionalText(50)
  vehiclePlateState?: string | null;

  /** Purchase option price in cents (0 up to the column's limit). */
  @ApiProperty({ type: Number, nullable: true, required: false })
  @IsOptional()
  @IsInt({ message: "The purchase option must be a whole number of cents." })
  @Min(0, { message: "The purchase option cannot be negative." })
  @Max(MAX_INTEGER_CENTS, { message: "The purchase option is too large." })
  purchaseOptionCents?: number | null;

  /** The driver's address on one line, as typed. */
  @OptionalText(300)
  lesseeAddress?: string | null;

  /** Driver's licence number. Sensitive: only in the single draft response, never in a list (B94). */
  @OptionalText(50)
  licenseNumber?: string | null;

  /** The state that issued the licence, as typed. */
  @OptionalText(50)
  licenseState?: string | null;

  /** Driver's date of birth, a real day written `YYYY-MM-DD`. Sensitive: only in the single draft response (B94). */
  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "The date must be YYYY-MM-DD." })
  @IsCalendarDay({
    message: "The date of birth must be a real day, written YYYY-MM-DD.",
  })
  dateOfBirth?: string | null;
}

/** One company of the fixed list the Lessor is chosen from. */
export class ContractCompanyDto {
  id: string;
  /** The name as printed on the contract, and as the company's signature (D72). */
  name: string;
  /** The address on one line, as printed on the contract. */
  address: string;
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
