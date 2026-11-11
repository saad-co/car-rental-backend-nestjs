import {
  addDays,
  chicagoInstant,
  daysBetween,
} from "../common/chicago-date.js";
import { ContractSchedule } from "../contracts/contract.entity.js";
import {
  LedgerDirection,
  LedgerEntryKind,
} from "../ledger/ledger-entry.entity.js";

/**
 * The rules of the daily operations page (Dashboard page 1, D92) as pure functions: no database, no clock of their own
 * (`now` is a parameter), integer cents only (spec rule 1). The service reads the ledger and the contracts and calls
 * these; the tests call them with hand-worked numbers. Nothing here is stored: "late" is worked out every time the page
 * is read.
 */

/** A payment is Early Warning when its oldest late rent charge is a full day (24 hours) past due (client, section 3). */
export const EARLY_WARNING_DAYS = 1;
/** A weekly driver is Should Be Deactivated when a payment is 2 days late (client, section 4). */
export const WEEKLY_DEACTIVATION_DAYS = 2;
/** A daily driver is Should Be Deactivated when 2 daily payments are late or missed (client, section 4). */
export const DAILY_DEACTIVATION_COUNT = 2;
/** A deposit still unpaid 7 days after its due date puts the driver on the list (client, section 4). */
export const DEPOSIT_DEACTIVATION_DAYS = 7;

/** One ledger line as the allocation needs it. `amountCents` is positive; `direction` says which way. */
export interface LedgerLine {
  id: string;
  direction: LedgerDirection;
  kind: LedgerEntryKind;
  amountCents: number;
  /** The Chicago day the line belongs to, `YYYY-MM-DD` (for a rent charge: its due date). */
  effectiveDate: string;
}

/** A debit with how much of it is still unpaid after every credit has been applied oldest first. */
export interface OpenCharge {
  id: string;
  kind: LedgerEntryKind;
  effectiveDate: string;
  amountCents: number;
  /** 0 = fully paid; up to `amountCents` = nothing paid. */
  openCents: number;
}

/**
 * Applies the driver's credits to the driver's debits, oldest first, and says how much of each debit is left. The same
 * rule as the ledger page's aging tiles (`ageBalance`, D92 decision "oldest-first"): all credits (payments, discounts)
 * form one pool; the debits are walked in order and the pool pays each one off before moving to the next. A debit is
 * paid first only if it is older: the deposit and fees posted at signing are paid before the next week's rent. Whatever is
 * left in the pool at the end is the driver being paid ahead.
 *
 * `lines` must already be in date order (oldest first, ties in the order they were recorded), and must not contain a
 * reversal or the entry it reversed: together they are zero, so leaving both out gives the same balance.
 */
export function openCharges(lines: LedgerLine[]): OpenCharge[] {
  let pool = lines
    .filter((line) => line.direction === LedgerDirection.credit)
    .reduce((sum, line) => sum + line.amountCents, 0);
  const charges: OpenCharge[] = [];
  for (const line of lines) {
    if (line.direction !== LedgerDirection.debit) continue;
    const paid = Math.min(line.amountCents, pool);
    pool -= paid;
    charges.push({
      id: line.id,
      kind: line.kind,
      effectiveDate: line.effectiveDate,
      amountCents: line.amountCents,
      openCents: line.amountCents - paid,
    });
  }
  return charges;
}

/**
 * The instant a rent charge is due: its due date at the driver's due time (Chicago clock). With no time set the payment
 * is due when the due day ends, that is at the start of the next day (D92 decision: no made-up clock time).
 */
export function dueMoment(
  dueDate: string,
  rentDueTime: string | null,
  extraDays = 0,
): Date {
  return rentDueTime === null
    ? chicagoInstant(addDays(dueDate, extraDays + 1), "00:00")
    : chicagoInstant(addDays(dueDate, extraDays), rentDueTime);
}

/** The time of day as stored (`18:00:00`) or as sent (`18:00`), cut to `HH:MM`; null stays null. */
export function minuteTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

/** A rent charge that is open and past its due moment. */
export interface LateCharge {
  id: string;
  dueDate: string;
  /** What is still unpaid of this charge. */
  openCents: number;
  /** Real hours since the due moment, rounded down. */
  hoursLate: number;
  /**
   * Whole days late counted on the Chicago clock: 1 once the same time on the next day has come (due Wednesday 6 PM, one
   * day late from Thursday 6 PM, whatever daylight saving did in between), 0 before.
   */
  daysLate: number;
}

/** How late a driver's rent is right now. */
export interface Lateness {
  /** Open rent charges past their due moment, oldest first. */
  lateCharges: LateCharge[];
  /** Their open amounts added up: "amount past due". */
  pastDueCents: number;
  /** The oldest late charge, or null when nothing is late. */
  oldest: LateCharge | null;
}

/**
 * Whole days late, counted on the Chicago clock. `now` must be after the due moment. Starts from the real-time estimate
 * and corrects by at most a day for a daylight-saving change in between.
 */
function wholeDaysLate(
  dueDate: string,
  rentDueTime: string | null,
  now: Date,
): number {
  const due = dueMoment(dueDate, rentDueTime);
  let days = Math.max(
    0,
    Math.floor((now.getTime() - due.getTime()) / 86_400_000) - 1,
  );
  while (now >= dueMoment(dueDate, rentDueTime, days + 1)) days++;
  return days;
}

/**
 * Which of the driver's rent charges are late at `now`. A charge is late when it still has an open amount and `now` is
 * after its due moment (at exactly the due time it is not late yet). Only charges of kind `rent` count: a deposit or a
 * fee is not a late payment (the deposit has its own rule, `depositStatus`).
 */
export function rentLateness(
  charges: OpenCharge[],
  rentDueTime: string | null,
  now: Date,
): Lateness {
  const lateCharges: LateCharge[] = charges
    .filter(
      (charge) =>
        charge.kind === LedgerEntryKind.rent &&
        charge.openCents > 0 &&
        now > dueMoment(charge.effectiveDate, rentDueTime),
    )
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .map((charge) => ({
      id: charge.id,
      dueDate: charge.effectiveDate,
      openCents: charge.openCents,
      hoursLate: Math.floor(
        (now.getTime() -
          dueMoment(charge.effectiveDate, rentDueTime).getTime()) /
          3_600_000,
      ),
      daysLate: wholeDaysLate(charge.effectiveDate, rentDueTime, now),
    }));
  return {
    lateCharges,
    pastDueCents: lateCharges.reduce(
      (sum, charge) => sum + charge.openCents,
      0,
    ),
    oldest: lateCharges[0] ?? null,
  };
}

/** Late payments list (D2): at least one late rent charge. */
export function isLate(lateness: Lateness): boolean {
  return lateness.lateCharges.length > 0;
}

/** Early Warning (D3): the oldest late charge is a full day or more past due. */
export function isEarlyWarning(lateness: Lateness): boolean {
  return (lateness.oldest?.daysLate ?? 0) >= EARLY_WARNING_DAYS;
}

/** The status of a payment due today (D1). */
export type DueStatus = "paid" | "not_yet_paid" | "late";

/** Paid: nothing open. Late: open and past its due moment. Not yet paid: open, due moment not reached. */
export function dueStatus(
  charge: OpenCharge,
  rentDueTime: string | null,
  now: Date,
): DueStatus {
  if (charge.openCents === 0) return "paid";
  return now > dueMoment(charge.effectiveDate, rentDueTime)
    ? "late"
    : "not_yet_paid";
}

/** The deposit of a driver's signed contract, as the rules need it. */
export interface DepositInput {
  /** The contract's security deposit in cents (0 = the contract has none). */
  depositCents: number;
  /** Staff ticked the "Deposit paid" step (B106: ticking does not touch the ledger). */
  ticked: boolean;
  /** The contract start date: the deposit is due at pickup (D92 decision). */
  startDate: string;
}

/** An unpaid deposit: how long since it was due. */
export interface DepositStatus {
  /** Days since the due date; negative before it. */
  daysSinceDue: number;
  /** 7 or more days since the due date. */
  overdue: boolean;
}

/**
 * `null` when there is nothing owed (no deposit on the contract, or the step is ticked). Otherwise how long it has been
 * due: overdue from 7 days after the contract start date.
 */
export function depositStatus(
  deposit: DepositInput,
  today: string,
): DepositStatus | null {
  if (deposit.depositCents <= 0 || deposit.ticked) return null;
  const daysSinceDue = daysBetween(deposit.startDate, today);
  return {
    daysSinceDue,
    overdue: daysSinceDue >= DEPOSIT_DEACTIVATION_DAYS,
  };
}

/** Why a driver is on the Should Be Deactivated list. */
export const DEACTIVATION_REASONS = [
  "daily_late",
  "weekly_late",
  "deposit_unpaid",
] as const;
export type DeactivationReason = (typeof DEACTIVATION_REASONS)[number];

/**
 * Every reason the driver is on the Should Be Deactivated list (D4), none when they should not be. A driver on a payment
 * plan is never listed (the client's exception: staff switch the flag off when the plan is broken). `schedule` is the
 * schedule of the contract in force; a driver without one has no rent rules, only the deposit rule.
 * - daily driver: 2 or more late rent charges;
 * - weekly driver: the oldest late charge is 2 days late;
 * - any driver: the deposit is overdue.
 */
export function deactivationReasons(input: {
  schedule: ContractSchedule | null;
  lateness: Lateness;
  deposit: DepositStatus | null;
  onPaymentPlan: boolean;
}): DeactivationReason[] {
  if (input.onPaymentPlan) return [];
  const reasons: DeactivationReason[] = [];
  if (
    input.schedule === ContractSchedule.daily &&
    input.lateness.lateCharges.length >= DAILY_DEACTIVATION_COUNT
  ) {
    reasons.push("daily_late");
  }
  if (
    input.schedule === ContractSchedule.weekly &&
    (input.lateness.oldest?.daysLate ?? 0) >= WEEKLY_DEACTIVATION_DAYS
  ) {
    reasons.push("weekly_late");
  }
  if (input.deposit?.overdue) reasons.push("deposit_unpaid");
  return reasons;
}
