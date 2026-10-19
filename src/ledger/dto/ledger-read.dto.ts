import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, Matches } from "class-validator";
import { DateRangeQueryDto } from "../../common/dto/date-range-query.dto.js";
import {
  PaymentManualMethod,
  PaymentSource,
  PaymentStatus,
} from "../../payments/payment.entity.js";
import { LedgerEntryDto } from "./ledger-entry.dto.js";

/** Which entries `GET /drivers/:id/ledger` lists. Omit for all. */
export enum LedgerTypeFilter {
  /** A debit: rent and charges entered by hand. */
  charges = "charges",
  /** A credit entered by hand (discount, waived fee). */
  credits = "credits",
  /** Payments credited to the driver. */
  payments = "payments",
  /** Reversals of any entry. */
  reversals = "reversals",
}

/** Which end of the history comes first. */
export enum LedgerOrder {
  asc = "asc",
  desc = "desc",
}

/**
 * Query of `GET /drivers/:id/ledger`: paging, a text search, a date range and a type filter. The dates are the days
 * the entries belong to (`effectiveDate`, plain Chicago calendar days), both included. The search finds a reference
 * (`CH-1042`), an amount (`85`, `$85.00`: entries of exactly that amount) or text in the description, the internal
 * note and the email of the admin who entered it.
 */
export class LedgerListQueryDto extends DateRangeQueryDto {
  /** Only this type of entry. Omit for all. */
  @ApiPropertyOptional({ enum: LedgerTypeFilter, enumName: "LedgerTypeFilter" })
  @IsOptional()
  @IsEnum(LedgerTypeFilter)
  type?: LedgerTypeFilter;

  /** `desc`: newest first (the default). `asc`: oldest first. */
  @ApiPropertyOptional({ enum: LedgerOrder, enumName: "LedgerOrder" })
  @IsOptional()
  @IsEnum(LedgerOrder)
  order?: LedgerOrder;
}

/** One row of the ledger history: the entry plus the balance right after it and what links it to other rows. */
export class LedgerRowDto extends LedgerEntryDto {
  /** Balance after this entry, in date order (credits minus debits; negative = owes). */
  runningBalanceCents: number;
  /** The reference of the charge this credit is applied against. */
  appliesToRef: string | null;
  /** The reference of the entry this reversal cancels. */
  reversalOfRef: string | null;
  /** The reference of the reversal that cancelled this entry. */
  reversedByRef: string | null;
  /** For a payment row: where the payment came from. */
  @ApiProperty({
    enum: PaymentSource,
    enumName: "PaymentSource",
    nullable: true,
  })
  paymentSource: PaymentSource | null;
  /** For a payment row recorded by hand: how it was paid. */
  @ApiProperty({
    enum: PaymentManualMethod,
    enumName: "PaymentManualMethod",
    nullable: true,
  })
  paymentManualMethod: PaymentManualMethod | null;
  /** For a payment row recorded by hand and still confirmed: it can be voided. */
  canVoidPayment: boolean;
  /**
   * For a charge that can still be credited against: how much of it is left (its amount minus the active credits
   * applied to it). Null when it cannot (not a charge, reversed, or already fully credited).
   */
  creditableCents: number | null;
}

/** Sums over every entry that matches the filters (all pages, not only this one). */
export class LedgerTotalsDto {
  /** Sum of the debits (charges) among them. */
  debitCents: number;
  /** Sum of the credits among them (payments, credits, and reversals of charges). */
  creditCents: number;
}

/** One page of a driver's ledger. */
export class LedgerPageDto {
  items: LedgerRowDto[];
  /** Entries that match the filters, across pages. */
  total: number;
  page: number;
  limit: number;
  /** The driver's balance now (credits minus debits; negative = owes), whatever the filters. */
  balanceCents: number;
  totals: LedgerTotalsDto;
  /**
   * Balance at the start of the `from` day: every entry dated before it. Null when no `from` was given. A statement
   * starts from it.
   */
  balanceBeforeCents: number | null;
}

/** How the summary groups entries. Weeks run Monday to Sunday; both in Chicago days (D60). */
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

/**
 * What the driver owes, by how old each charge is (first in, first out: payments and credits pay off the oldest
 * charges first). The five numbers are what is still unpaid; they add up to what the driver owes.
 */
export class LedgerAgingDto {
  /** Charges 0 to 6 days old. */
  currentCents: number;
  /** Charges 7 to 13 days old. */
  days7to13Cents: number;
  /** Charges 14 to 29 days old. */
  days14to29Cents: number;
  /** Charges 30 or more days old. */
  days30PlusCents: number;
  /** Everything 7 days old or more (the three numbers above it). */
  pastDueCents: number;
}

/** The driver's newest confirmed payment. */
export class LedgerLastPaymentDto {
  amountCents: number;
  @ApiProperty({ enum: PaymentSource, enumName: "PaymentSource" })
  source: PaymentSource;
  @ApiProperty({
    enum: PaymentManualMethod,
    enumName: "PaymentManualMethod",
    nullable: true,
  })
  manualMethod: PaymentManualMethod | null;
  occurredAt: Date;
}

/** `GET /drivers/:id/ledger/overview`: the top of the ledger page. */
export class LedgerOverviewDto {
  /** Credits minus debits; negative = the driver owes. */
  balanceCents: number;
  aging: LedgerAgingDto;
  lastPayment: LedgerLastPaymentDto | null;
  /** The Chicago day the ages are counted to, `YYYY-MM-DD`. */
  asOf: string;
}

/** A short description of another entry, for the links in the details. */
export class LedgerEntryLinkDto {
  id: string;
  ref: string;
  description: string;
  effectiveDate: string;
  createdAt: Date;
  createdByEmail: string | null;
}

/** A credit applied against the charge, with its amount and whether it was reversed since. */
export class LedgerAppliedCreditDto extends LedgerEntryLinkDto {
  amountCents: number;
  reversed: boolean;
}

/** The payment behind a payment entry. */
export class LedgerPaymentInfoDto {
  id: string;
  @ApiProperty({ enum: PaymentSource, enumName: "PaymentSource" })
  source: PaymentSource;
  @ApiProperty({
    enum: PaymentManualMethod,
    enumName: "PaymentManualMethod",
    nullable: true,
  })
  manualMethod: PaymentManualMethod | null;
  senderName: string;
  /** The provider's transaction id, or the reference typed for a manual payment. */
  transactionId: string | null;
  occurredAt: Date;
  @ApiProperty({ enum: PaymentStatus, enumName: "PaymentStatus" })
  status: PaymentStatus;
}

/** `GET /drivers/:id/ledger/entries/:entryId`: one entry with everything that links to it. */
export class LedgerEntryDetailsDto {
  entry: LedgerEntryDto;
  /** For a reversal: the entry it cancels. */
  reversalOf: LedgerEntryLinkDto | null;
  /** The reversal that cancelled this entry. */
  reversedBy: LedgerEntryLinkDto | null;
  /** For a credit: the charge it is applied against. */
  appliesTo: LedgerEntryLinkDto | null;
  /** For a charge: the credits applied against it, oldest first. */
  appliedCredits: LedgerAppliedCreditDto[];
  /** For a payment entry: the payment. */
  payment: LedgerPaymentInfoDto | null;
  /** For a charge: how much of it can still be credited, or null. */
  creditableCents: number | null;
  /** For a payment entry recorded by hand and still confirmed: it can be voided. */
  canVoidPayment: boolean;
}
