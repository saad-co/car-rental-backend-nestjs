import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  LedgerDirection,
  LedgerEntryKind,
  MAX_DESCRIPTION_LENGTH,
} from "../ledger-entry.entity.js";

/** Largest manual entry an admin can type: $10,000 (D60). Larger amounts are almost certainly a typo. */
export const MAX_MANUAL_ENTRY_CENTS = 1_000_000;

/** How far back a manual entry may be dated (D60). */
export const MAX_BACKDATE_DAYS = 90;

/** Trims strings before validation, so "   " is refused as empty. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** Body of `POST /drivers/:id/ledger/entries`: a charge or credit entered by an admin. */
export class CreateLedgerEntryDto {
  /**
   * `debit`: a charge, the driver owes more (late fee, flat tire, damage, toll…). `credit`: the driver owes less
   * (a discount, money handed back…). What it was for goes in `reason` (D61).
   */
  @ApiProperty({ enum: LedgerDirection, enumName: "LedgerDirection" })
  @IsEnum(LedgerDirection, { message: "Choose charge or credit." })
  direction: LedgerDirection;

  /** Whole cents, 1 to 1,000,000 ($10,000). Always positive: `direction` says which way it goes. */
  @IsInt({ message: "The amount must be a whole number of cents." })
  @Min(1, { message: "The amount must be more than $0." })
  @Max(MAX_MANUAL_ENTRY_CENTS, {
    message: "The amount can be at most $10,000.",
  })
  amountCents: number;

  /** The day the charge or credit belongs to, `YYYY-MM-DD` in Chicago: today or up to 90 days back. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "The date must be YYYY-MM-DD." })
  effectiveDate: string;

  /** Why, e.g. "Flat tire, rear left, replaced at Discount Tire". 1 to 500 characters after trimming. */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "The reason is empty." })
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  reason: string;

  /**
   * A UUID the form makes once per entry. Sending the same request again (a double click, a retry after a timeout)
   * returns the entry already made instead of making a second one.
   */
  @IsUUID()
  requestKey: string;
}

/** Body of `POST /drivers/:id/ledger/entries/:entryId/reverse`. */
export class ReverseLedgerEntryDto {
  /** Why the entry is cancelled, e.g. "Late fee waived by the owner". 1 to 400 characters after trimming. */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "The reason is empty." })
  @MaxLength(400)
  reason: string;
}

/** One ledger entry, as the driver page shows it. */
export class LedgerEntryDto {
  id: string;
  driverId: string;
  @ApiProperty({ enum: LedgerDirection, enumName: "LedgerDirection" })
  direction: LedgerDirection;
  /** Always positive; `direction` says which way. */
  amountCents: number;
  @ApiProperty({ enum: LedgerEntryKind, enumName: "LedgerEntryKind" })
  kind: LedgerEntryKind;
  description: string;
  /** The Chicago day it belongs to, `YYYY-MM-DD`. */
  effectiveDate: string;
  paymentId: string | null;
  /** The entry this one cancels (reversals only). */
  reversalOfId: string | null;
  /** The reversal that cancelled this entry, if any. */
  reversedById: string | null;
  /** True when an admin may reverse it here: not a reversal, not a payment credit, not reversed already. */
  canReverse: boolean;
  /** Null for entries made by the system (payment credits from matching). */
  createdById: string | null;
  createdByEmail: string | null;
  /** When it was recorded (may be later than `effectiveDate`). */
  createdAt: Date;
}
