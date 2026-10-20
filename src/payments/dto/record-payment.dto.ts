import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { MAX_MANUAL_ENTRY_CENTS } from "../../ledger/dto/ledger-entry.dto.js";
import { PaymentManualMethod } from "../payment.entity.js";

/** Trims strings before validation; a blank string becomes undefined (= left out). */
const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() || undefined : value;

/** Body of `POST /payments/manual`: a payment an admin received (cash, a check, a card in the office, ...). */
export class RecordPaymentDto {
  /** The driver who paid. */
  @IsUUID()
  driverId: string;

  /** How it was paid. Zelle, Cash App, Venmo, Stripe and Chime payments normally arrive by email by themselves. */
  @ApiProperty({ enum: PaymentManualMethod, enumName: "PaymentManualMethod" })
  @IsEnum(PaymentManualMethod, { message: "Choose how it was paid." })
  method: PaymentManualMethod;

  /** Whole cents, 1 to 1,000,000 ($10,000). */
  @IsInt({ message: "The amount must be a whole number of cents." })
  @Min(1, { message: "The amount must be more than $0." })
  @Max(MAX_MANUAL_ENTRY_CENTS, {
    message: "The amount can be at most $10,000.",
  })
  amountCents: number;

  /** The day it was paid, `YYYY-MM-DD` in Chicago: today or up to 90 days back. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "The date must be YYYY-MM-DD." })
  paidOn: string;

  /**
   * A receipt number, check number or confirmation code, if there is one. Two manual payments cannot share the same
   * reference (a check recorded twice is refused).
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(100)
  reference?: string;

  /**
   * A UUID the form makes once per payment. Sending the same request again (a double click, a retry) returns the
   * payment already recorded instead of recording a second one.
   */
  @IsUUID()
  requestKey: string;

  /**
   * Set to true to record it although the driver already has a confirmed payment of the same amount within three
   * days (the answer to the "possible duplicate" warning).
   */
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;

  /**
   * The text for the driver's statement. Empty: the ledger writes its own ("Cash payment · ref 17"). Up to 500
   * characters.
   */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(500)
  description?: string;

  /** A note for staff only (optional, up to 500 characters). Typed once; copied to the ledger credit; never on a statement. */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(500)
  internalNote?: string;
}

/** Body of `POST /payments/:id/void`. */
export class VoidPaymentDto {
  /** Why the payment is voided, e.g. "Check bounced". 1 to 400 characters after trimming. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: "The reason is empty." })
  @MaxLength(400)
  reason: string;
}
