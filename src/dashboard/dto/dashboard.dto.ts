import { ApiProperty } from "@nestjs/swagger";
import { EmailIntakeOutcome } from "../../email-intake/email-intake-status.entity.js";
import { PaymentSource } from "../../payments/payment.entity.js";

/**
 * The admin dashboard (spec section 10, D88). Every figure is worked out on the server: money in integer cents (spec rule 1),
 * days as Chicago `YYYY-MM-DD` days (spec rule 4), percentages as whole numbers 0-100. The browser only formats.
 */

/** Money that arrived, from the confirmed payments (money that reached a driver's ledger, D49). */
export class DashboardPaymentsDto {
  /** Everything that came in: confirmed payments plus the unmatched queue (rejected ones left out), in cents. */
  processedCents: number;
  /** How many payments that is. */
  processedCount: number;
  /** Sum of the confirmed (matched) payments, in cents. */
  grossCents: number;
  /** How many confirmed payments. */
  grossCount: number;
  /** Confirmed payments as a share of (confirmed + unmatched), 0-100. Rejected payments are left out. */
  matchedPercent: number;
  /** Sum of the unmatched payments (the queue), in cents. */
  queueCents: number;
  /** How many unmatched payments. */
  queueCount: number;
  /** Of the unmatched ones, how many the matcher has already tried and a person must assign. */
  needsReviewCount: number;
  /** Confirmed payments on today's Chicago day, in cents. */
  todayCents: number;
  /** Today and the 6 days before it (Chicago days), in cents. */
  last7DaysCents: number;
  /** Today and the 29 days before it (Chicago days), in cents. */
  last30DaysCents: number;
  /** Monday to today (Chicago), in cents. */
  thisWeekCents: number;
  /** How many confirmed payments came in this week. */
  thisWeekCount: number;
  /** Average confirmed payment, in cents (rounded). 0 when there is none. */
  averageCents: number;
  /** The largest confirmed payment, in cents. */
  largestCents: number;
}

/** One day of the revenue trend. */
export class DashboardTrendDayDto {
  /** Chicago day, `YYYY-MM-DD`. */
  day: string;
  /** Confirmed payments on that day, in cents. 0 for a quiet day. */
  amountCents: number;
}

/** One payment source (Zelle, Cash App, ...). */
export class DashboardSourceDto {
  @ApiProperty({ enum: PaymentSource, enumName: "PaymentSource" })
  source: PaymentSource;
  /** Confirmed money from this source, in cents. */
  amountCents: number;
  /** Confirmed payments from this source. */
  count: number;
  /** Unmatched payments from this source. */
  unmatchedCount: number;
  /** This source's share of all confirmed money, 0-100 (rounded, so the shares may not add up to exactly 100). */
  sharePercent: number;
}

/** Active drivers, split by the schedule of the signed contract in force today. */
export class DashboardDriversDto {
  /** Active, not archived drivers. */
  active: number;
  /** Of them, on a daily contract. */
  daily: number;
  /** Of them, on a weekly contract. */
  weekly: number;
  /** Of them, with no signed contract in force yet (nothing to bill). */
  withoutContract: number;
  /** `daily` as a share of daily + weekly, 0-100. */
  dailyPercent: number;
  /** `weekly` as a share of daily + weekly, 0-100. */
  weeklyPercent: number;
}

/** The weekdays, Monday first. */
export type DashboardWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** Weekly rent grouped by the weekday the contract falls due on (the weekday of its start date). */
export class DashboardWeekdayDto {
  @ApiProperty({
    enum: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ],
    enumName: "DashboardWeekday",
  })
  weekday: DashboardWeekday;
  /** Active drivers on a weekly contract due that day. */
  drivers: number;
  /** Their weekly rent added up, in cents. */
  expectedCents: number;
}

/** What is billed today and what is owed by drivers who left. */
export class DashboardBillingDto {
  /** Rent that falls due today, in cents: exactly what the hourly rent job posts for today (daily + weekly). */
  dueTodayCents: number;
  /** Of it, from daily contracts, in cents. */
  dailyDueCents: number;
  /** Of it, from weekly contracts, in cents. */
  weeklyDueCents: number;
  /** Drivers with daily rent due today. */
  dailyDueDrivers: number;
  /** Drivers with weekly rent due today. */
  weeklyDueDrivers: number;
  /** What inactive drivers (not in collections) still owe, in cents. */
  inactiveOwedCents: number;
  /** What drivers sent to collections still owe, in cents. */
  collectionsOwedCents: number;
  /** The seven weekdays, Monday first. */
  weeklyByDay: DashboardWeekdayDto[];
}

/** A driver who owes money. */
export class DashboardWatchlistDriverDto {
  driverId: string;
  /** First and last name. */
  name: string;
  /** Negative: the driver owes this much, in cents. */
  balanceCents: number;
}

/** Ledger balances of the active and inactive drivers (archived and onboarding ones are left out). */
export class DashboardBalancesDto {
  /** How many drivers are counted. */
  driverCount: number;
  /** All their balances added up (credits minus debits), in cents. Negative: the fleet owes more than it holds. */
  fleetBalanceCents: number;
  /** Drivers with a credit balance. */
  positiveCount: number;
  /** Drivers at exactly zero. */
  zeroCount: number;
  /** Drivers who owe money. */
  negativeCount: number;
  /** The credits of the drivers in credit, added up, in cents. */
  creditCents: number;
  /** What the drivers who owe money owe, added up, in cents (a positive number): the total outstanding. */
  outstandingCents: number;
  /** The 8 drivers who owe the most, most first. */
  watchlist: DashboardWatchlistDriverDto[];
}

/** Applications (archived ones left out) and drivers still in onboarding. */
export class DashboardApplicationsDto {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  onHold: number;
  /** Approved as a share of approved + rejected + on hold, 0-100. 0 when none was reviewed. */
  approvalPercent: number;
  /** Drivers whose onboarding is not finished (not archived). */
  onboardingDrivers: number;
}

/** Mails read from the mailbox, by outcome. */
export class DashboardMailCountsDto {
  processed: number;
  notPayment: number;
  rejectedUnverified: number;
  extractionFailed: number;
  duplicatePayment: number;
}

/** How the latest mailbox run ended (the one-row `email_intake_status` table). */
export class DashboardIntakeRunDto {
  /** When the latest run ended. */
  at: Date;
  @ApiProperty({ enum: EmailIntakeOutcome, enumName: "EmailIntakeOutcome" })
  outcome: EmailIntakeOutcome;
  /** Emails the latest run stored. */
  stored: number;
  /** When a run last worked; kept through later failures. Null: never. */
  lastSuccessAt: Date | null;
  /** Why the latest run failed. Set only when `outcome` is `failed`. */
  error: string | null;
}

/** The payment mailbox: the latest run, and what was stored. */
export class DashboardIntakeDto {
  /** The latest run, or null when none has been recorded yet (a new database, or intake never started). */
  lastRun: DashboardIntakeRunDto | null;
  /** Mails stored in the last 24 hours, by outcome. */
  last24Hours: DashboardMailCountsDto;
  /** Mails stored in the last 7 days, by outcome. */
  last7Days: DashboardMailCountsDto;
  /** When the newest stored mail arrived, or null when there is none. */
  lastEmailAt: Date | null;
  /** Payments the matcher has not looked at yet. */
  awaitingMatchCount: number;
}

/** Text messages (Quo). */
export class DashboardSmsDto {
  @ApiProperty({ enum: ["off", "dry_run", "live"], enumName: "SmsServiceMode" })
  mode: "off" | "dry_run" | "live";
  /** Whether a Quo key and number are set. */
  quoConfigured: boolean;
  /** Texts sent in the last 7 days that failed or were not delivered. */
  failedLast7Days: number;
}

export class DashboardDto {
  /** When this was worked out. */
  asOf: Date;
  /** Today's Chicago day, `YYYY-MM-DD`. */
  today: string;
  payments: DashboardPaymentsDto;
  /** The last 21 Chicago days, oldest first, quiet days included. */
  trend: DashboardTrendDayDto[];
  /** Sources with confirmed money or unmatched payments, biggest first. */
  sources: DashboardSourceDto[];
  drivers: DashboardDriversDto;
  billing: DashboardBillingDto;
  balances: DashboardBalancesDto;
  applications: DashboardApplicationsDto;
  intake: DashboardIntakeDto;
  sms: DashboardSmsDto;
}
