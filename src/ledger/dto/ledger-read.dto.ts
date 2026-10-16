import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsOptional, Matches } from "class-validator";
import { LedgerEntryDto } from "./ledger-entry.dto.js";

/** One row of the ledger history: the entry plus the balance right after it. */
export class LedgerRowDto extends LedgerEntryDto {
  /** Balance after this entry, in date order (credits minus debits; negative = owes). */
  runningBalanceCents: number;
}

/** One page of a driver's ledger, newest first. */
export class LedgerPageDto {
  items: LedgerRowDto[];
  /** All entries of the driver, across pages. */
  total: number;
  page: number;
  limit: number;
  /** The driver's balance now (credits minus debits; negative = owes). */
  balanceCents: number;
}

/** How the summary groups entries. Weeks run Monday to Sunday; both in Chicago days (D58). */
export enum LedgerPeriod {
  week = "week",
  month = "month",
}

/** Query of `GET /drivers/:id/ledger/summary`. */
export class LedgerSummaryQueryDto {
  @ApiProperty({ enum: LedgerPeriod, enumName: "LedgerPeriod" })
  @IsEnum(LedgerPeriod)
  period: LedgerPeriod;

  /** First day to cover, `YYYY-MM-DD` (its whole week or month is included). Default: 11 periods before `to`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "from must be YYYY-MM-DD." })
  from?: string;

  /** Last day to cover, `YYYY-MM-DD` (its whole week or month is included). Default: today in Chicago. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "to must be YYYY-MM-DD." })
  to?: string;
}

/**
 * One week or month. `closingCents = openingCents + paymentsCents + creditsCents − chargesCents + reversalsCents`,
 * and each period's opening is the previous period's closing.
 */
export class LedgerPeriodDto {
  /** First day, `YYYY-MM-DD` (a Monday for weeks, the 1st for months). */
  start: string;
  /** Last day, `YYYY-MM-DD` (a Sunday for weeks). */
  end: string;
  /** Balance before the period. */
  openingCents: number;
  /** Charges (rent and manual charges, incl. a debit opening balance). */
  chargesCents: number;
  /** Payments credited. */
  paymentsCents: number;
  /** Manual credits (discounts, goodwill, a credit opening balance). */
  creditsCents: number;
  /** Net effect of reversals made in the period: positive gives money back to the driver, negative takes it. */
  reversalsCents: number;
  /** Balance at the end of the period. */
  closingCents: number;
  entryCount: number;
}

/** A driver's ledger by week or month, newest period first. Periods without entries are included. */
export class LedgerSummaryDto {
  @ApiProperty({ enum: LedgerPeriod, enumName: "LedgerPeriod" })
  period: LedgerPeriod;
  items: LedgerPeriodDto[];
}
