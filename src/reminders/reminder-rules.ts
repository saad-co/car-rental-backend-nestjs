import { chicagoDate } from "../common/chicago-date.js";
import { formatCents } from "../common/money.js";
import { ContractSchedule } from "../contracts/contract.entity.js";
import { dueMoment } from "../dashboard/daily-ops.js";

/**
 * The payment-reminder rules as pure functions (Fleet revisions section 6, the client's own wording; PHASE1_SPEC section 8):
 * no database, no clock of their own (`now` is a parameter), integer cents (spec rule 1). The service reads the ledger and
 * the reminder log, builds `ReminderFacts` for one driver and calls `nextReminder`; the tests call it with hand-worked
 * numbers. The lateness itself (which rent charges are late) comes from `daily-ops.ts`, the same rules as the dashboard.
 */

/** Balance reminders start when the past-due balance is OVER this: $100 (client, section 6). */
export const BALANCE_REMINDER_OVER_CENTS = 10_000;
/** Balance reminders repeat every 3 days (client, section 6). Real hours, so a daylight-saving day is 23 or 25 hours long. */
export const BALANCE_REMINDER_EVERY_HOURS = 72;
/**
 * The upcoming reminder goes out 48 hours before the due date and time (client, section 6): two Chicago days earlier at the
 * same wall-clock time (due Sunday 6 PM: Friday 6 PM), the way the dashboard counts days late. On the two daylight-saving
 * nights that is 47 or 49 real hours, so the text still arrives at the time the driver expects.
 */
export const UPCOMING_LEAD_DAYS = 2;
/** A daily driver gets a high-balance text at 2, 3, 4 and 5 payments behind (client, section 6). */
export const HIGH_BALANCE_TIERS = [2, 3, 4, 5] as const;

export enum ReminderKind {
  upcoming = "upcoming",
  late = "late",
  high_balance = "high_balance",
  balance = "balance",
  payment_received = "payment_received",
}

/** The next rent due date of a weekly driver, with what is due. */
export interface UpcomingDue {
  /** `YYYY-MM-DD`, a Chicago day. */
  dueDate: string;
  amountCents: number;
}

/** Everything the rules need to know about one driver at `now`. */
export interface ReminderFacts {
  driverId: string;
  now: Date;
  /** The schedule of the signed contract in force; null without one (then no rent rule applies). */
  schedule: ContractSchedule | null;
  /** The driver's due time, `HH:MM` Chicago; null = due when the day ends. */
  rentDueTime: string | null;
  /** How many rent charges are open and past their due moment: "payments behind". */
  lateCount: number;
  /** What is still unpaid of those charges, in cents. */
  pastDueCents: number;
  /** The ledger balance in cents (credits minus debits); negative = owes. */
  balanceCents: number;
  /** When the current "behind" stretch began (ISO); null when the driver is not behind. */
  episode: string | null;
  upcomingRemindersEnabled: boolean;
  balanceRemindersEnabled: boolean;
  /** A weekly driver's next due date, if one falls in the next few days and rent is billed for it. */
  upcoming: UpcomingDue | null;
  /** Keys of the reminders already sent (or composed, in the same mode) for this driver. */
  sentKeys: ReadonlySet<string>;
  /** When the last late, high-balance or balance reminder went out. */
  lastChaseAt: Date | null;
  /** When the driver's last payment was credited. */
  lastPaymentAt: Date | null;
  /** Any reminder (of any kind) already went out to the driver today, Chicago time. */
  textedToday: boolean;
  /** The driver's newest payment credit inside the confirmation window; null when there is none. */
  latestPayment: { entryId: string; at: Date } | null;
}

/** A reminder that is due now. `values` are the template's numbers; the service adds the first name and the link. */
export interface DueReminder {
  kind: ReminderKind;
  /** Unique per reminder: the database refuses a second one with the same key. */
  dedupeKey: string;
  /** For a high-balance reminder: how many payments behind. */
  tier: number | null;
  values: Record<string, string>;
}

/**
 * The one reminder to send this driver now, or null. Rules, in this order:
 * 1. After a payment: a short confirmation with what is still past due. Not held back by an earlier text today.
 * 2. Never two texts on the same Chicago day (the client: "if a high balance reminder and a balance reminder fall on the
 *    same day, send only one"): anything already sent today ends it.
 * 3. High balance (daily drivers, 2 to 5 behind), wins over...
 * 4. Late (the first missed payment of a stretch), wins over...
 * 5. Balance (past due over $100, every 3 days), wins over...
 * 6. Upcoming (weekly drivers, from 48 hours before the due moment until it).
 * Opted-out, archived, in-collections and inactive drivers are left out by the caller, never here.
 */
export function nextReminder(facts: ReminderFacts): DueReminder | null {
  const received = paymentReceived(facts);
  if (received) return received;
  if (facts.textedToday) return null;
  return highBalance(facts) ?? late(facts) ?? balance(facts) ?? upcoming(facts);
}

function paymentReceived(f: ReminderFacts): DueReminder | null {
  if (!f.latestPayment || f.pastDueCents <= 0) return null;
  const dedupeKey = `received:${f.latestPayment.entryId}`;
  if (f.sentKeys.has(dedupeKey)) return null;
  return {
    kind: ReminderKind.payment_received,
    dedupeKey,
    tier: null,
    values: { balance: formatCents(f.pastDueCents) },
  };
}

function highBalance(f: ReminderFacts): DueReminder | null {
  if (f.schedule !== ContractSchedule.daily || f.episode === null) return null;
  const tier = HIGH_BALANCE_TIERS.find((t) => t === f.lateCount);
  if (tier === undefined) return null;
  // Each threshold once per stretch of being behind: a driver who pays up and falls behind again is warned again.
  const dedupeKey = `high_balance:${f.driverId}:${tier}:${f.episode}`;
  if (f.sentKeys.has(dedupeKey)) return null;
  return {
    kind: ReminderKind.high_balance,
    dedupeKey,
    tier,
    values: {
      missedCount: String(tier),
      balance: formatCents(f.pastDueCents),
    },
  };
}

function late(f: ReminderFacts): DueReminder | null {
  if (f.lateCount < 1 || f.episode === null) return null;
  const dedupeKey = `late:${f.driverId}:${f.episode}`;
  if (f.sentKeys.has(dedupeKey)) return null;
  // One text when a payment is missed: a high-balance text sent in this stretch already told the driver, so the late
  // text must not follow it (a daily driver first seen 3 payments behind gets the "3 behind" text, not two).
  const told = [...f.sentKeys].some(
    (key) => key.startsWith("high_balance:") && key.endsWith(`:${f.episode}`),
  );
  if (told) return null;
  return {
    kind: ReminderKind.late,
    dedupeKey,
    tier: null,
    values: { balance: formatCents(f.pastDueCents) },
  };
}

function balance(f: ReminderFacts): DueReminder | null {
  if (!f.balanceRemindersEnabled) return null;
  if (f.pastDueCents <= BALANCE_REMINDER_OVER_CENTS) return null;
  // Any payment resets the 3-day clock, and so does any reminder about the balance: a driver who keeps paying is not nagged.
  const anchor = latest(f.lastChaseAt, f.lastPaymentAt);
  if (
    anchor !== null &&
    f.now.getTime() - anchor.getTime() <
      BALANCE_REMINDER_EVERY_HOURS * 3_600_000
  ) {
    return null;
  }
  const dedupeKey = `balance:${f.driverId}:${chicagoDate(f.now)}`;
  if (f.sentKeys.has(dedupeKey)) return null;
  return {
    kind: ReminderKind.balance,
    dedupeKey,
    tier: null,
    values: { balance: formatCents(f.pastDueCents) },
  };
}

function upcoming(f: ReminderFacts): DueReminder | null {
  if (
    f.schedule !== ContractSchedule.weekly ||
    !f.upcomingRemindersEnabled ||
    f.upcoming === null
  ) {
    return null;
  }
  const due = dueMoment(f.upcoming.dueDate, f.rentDueTime);
  const opens = dueMoment(
    f.upcoming.dueDate,
    f.rentDueTime,
    -UPCOMING_LEAD_DAYS,
  );
  if (f.now < opens || f.now >= due) return null;
  // Already paid ahead: the balance covers this payment, so telling the driver it is due would only nag.
  if (f.balanceCents >= f.upcoming.amountCents) return null;
  const dedupeKey = `upcoming:${f.driverId}:${f.upcoming.dueDate}`;
  if (f.sentKeys.has(dedupeKey)) return null;
  return {
    kind: ReminderKind.upcoming,
    dedupeKey,
    tier: null,
    values: {
      amount: formatCents(f.upcoming.amountCents),
      due: describeDue(f.upcoming.dueDate, f.rentDueTime),
    },
  };
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "short",
  day: "numeric",
});

/**
 * "Friday, Nov 14 at 6:00 PM", or "Friday, Nov 14 (by the end of the day)" when the driver has no due time (D92: no made-up
 * clock time). `dueTime` is `HH:MM`, 24 hours, Chicago.
 */
export function describeDue(dueDate: string, dueTime: string | null): string {
  const [y, m, d] = dueDate.split("-").map(Number);
  const day = dayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
  if (dueTime === null) return `${day} (by the end of the day)`;
  const [hour, minute] = dueTime.split(":").map(Number);
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  return `${day} at ${clock}`;
}
