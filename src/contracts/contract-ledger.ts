import { addDays } from "../common/chicago-date.js";
import { LedgerEntryKind } from "../ledger/ledger-entry.entity.js";
import { contractNumbers } from "./contract-math.js";
import { ContractSchedule, type Contract } from "./contract.entity.js";
import { formatLongDate } from "./contract-values.js";

/**
 * What a signed contract puts on the driver's ledger (Module 2 step 5, D83). Pure functions, integer cents (spec rule 1):
 * nothing here touches the database, so the signing and the rent job build their entries with the same code.
 */

/** One debit the system writes. `key` is the ledger's unique `idempotency_key`: the same key is never written twice. */
export interface SystemDebit {
  key: string;
  amountCents: number;
  kind: LedgerEntryKind;
  description: string;
  /** The day the money belongs to, `YYYY-MM-DD`. */
  effectiveDate: string;
}

/** The parts of a contract the ledger needs (the entity has them all). */
export type ContractForLedger = Pick<
  Contract,
  | "id"
  | "driverId"
  | "schedule"
  | "totalRateCents"
  | "startDate"
  | "termMonths"
  | "securityDepositCents"
  | "documentationFeeCents"
  | "insuranceStartFeeCents"
  | "otherOneTimeCents"
  | "holdVehicleCents"
  | "excessMileageCents"
  | "insuranceExcessCents"
  | "otherRecurringCents"
>;

/** The one-time charges in the order the contract lists them: the label, and where the amount is. */
const ONE_TIME_LINES: {
  field: keyof ContractForLedger;
  slug: string;
  label: string;
}[] = [
  {
    field: "securityDepositCents",
    slug: "security_deposit",
    label: "Security deposit (refundable)",
  },
  {
    field: "documentationFeeCents",
    slug: "documentation_fee",
    label: "Documentation fee",
  },
  {
    field: "insuranceStartFeeCents",
    slug: "insurance_start_fee",
    label: "Insurance policy start fee",
  },
  {
    field: "otherOneTimeCents",
    slug: "other_one_time",
    label: "Other one-time charge",
  },
  {
    field: "holdVehicleCents",
    slug: "hold_vehicle",
    label: "Hold vehicle payment",
  },
];

/** The ledger key of a rent debit for one due date: the same format for the first rent and for every job run. */
export function rentKey(driverId: string, dueDate: string): string {
  return `rent:${driverId}:${dueDate}`;
}

/** The days between rent payments: 7 for a weekly contract, 1 for a daily one. */
export function rentPeriodDays(schedule: ContractSchedule): number {
  return schedule === ContractSchedule.weekly ? 7 : 1;
}

/** The rent debit for one due date, with the contract's payment as its amount. */
export function rentDebit(
  contract: Pick<ContractForLedger, "driverId" | "schedule" | "totalRateCents">,
  dueDate: string,
): SystemDebit {
  const weekly = contract.schedule === ContractSchedule.weekly;
  return {
    key: rentKey(contract.driverId, dueDate),
    amountCents: contract.totalRateCents,
    kind: LedgerEntryKind.rent,
    description: weekly
      ? `Weekly rent, due ${formatLongDate(dueDate)}`
      : `Daily rent, ${formatLongDate(dueDate)}`,
    effectiveDate: dueDate,
  };
}

/**
 * The entries posted when the contract is signed: one debit per non-zero one-time charge (zero amounts are skipped),
 * then the first rent, all dated the contract's start date (the first payment is due at pickup). Amounts come from
 * `contractNumbers`, the code that printed the PDF.
 */
export function pickupEntries(contract: ContractForLedger): SystemDebit[] {
  const day = contract.startDate;
  const entries: SystemDebit[] = [];
  for (const line of ONE_TIME_LINES) {
    const amountCents = contract[line.field] as number;
    if (amountCents <= 0) continue;
    entries.push({
      key: `contract:${contract.id}:${line.slug}`,
      amountCents,
      kind: LedgerEntryKind.contract_charge,
      description: `${line.label}, contract of ${formatLongDate(day)}`,
      effectiveDate: day,
    });
  }
  const { paymentCents } = contractNumbers(contract);
  entries.push(rentDebit({ ...contract, totalRateCents: paymentCents }, day));
  return entries;
}

/**
 * The recurring lines of a contract that are not posted automatically (no client rule, or they need mileage from
 * Module 3), as labels for the admin; only the non-zero ones.
 */
export function notPostedAutomatically(
  contract: Pick<
    ContractForLedger,
    "excessMileageCents" | "insuranceExcessCents" | "otherRecurringCents"
  >,
): string[] {
  const lines: string[] = [];
  if (contract.excessMileageCents > 0) lines.push("Excess mileage per mile");
  if (contract.insuranceExcessCents > 0) {
    lines.push("Insurance excess per month");
  }
  if (contract.otherRecurringCents > 0) lines.push("Other recurring charge");
  return lines;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. Pure UTC calendar arithmetic. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/**
 * The rent due dates the job posts: start date + one period, + two periods, and so on (the start date itself is the first
 * rent, posted at signing), from `from` (the day billing starts, `drivers.rent_from`) up to and including `today`, both
 * Chicago days. Never before `from`, never after `today`; no end date, because the contract auto-extends weekly.
 */
export function rentDueDates(
  startDate: string,
  schedule: ContractSchedule,
  from: string,
  today: string,
  billsStartDate = false,
): string[] {
  const period = rentPeriodDays(schedule);
  const sinceStart = daysBetween(startDate, from);
  // The first multiple of the period that is at or after `from`. A signed contract's start date is its first rent, posted
  // at signing, so the job starts one period later; a manual charge (D100) has nobody posting its first rent, so the job
  // does, and the start date itself is a due date.
  const first = Math.max(
    billsStartDate ? 0 : 1,
    Math.ceil(sinceStart / period),
  );
  const dates: string[] = [];
  for (let n = first; ; n++) {
    const due = addDays(startDate, n * period);
    if (due > today) break;
    dates.push(due);
  }
  return dates;
}

/**
 * The first rent of a charge set by hand (D100), never before today: a start date in the past is never back-charged, and
 * the start date only fixes the weekday of a weekly charge. Daily: the later of the start date and `today`. Weekly: the
 * first day on or after that with the weekday of the start date (a Monday start saved on a Thursday bills the next Monday).
 * `startDate` and `today` are Chicago days (`YYYY-MM-DD`).
 */
export function firstRentDate(
  schedule: ContractSchedule,
  startDate: string,
  today: string,
): string {
  const base = startDate > today ? startDate : today;
  if (schedule === ContractSchedule.daily) return base;
  const daysIntoWeek = daysBetween(startDate, base) % 7;
  return addDays(base, (7 - daysIntoWeek) % 7);
}

/**
 * The earliest day a changed rent can start (D101): today, or the day after the last rent already posted to the driver's
 * ledger when that is later. A rent date that already has an entry could never be billed again (its ledger key exists), so a
 * change never starts on one: it starts on the next day, never silently skipped. `lastPostedRent` is the latest rent entry's
 * Chicago day (`YYYY-MM-DD`), or null when no rent was ever posted.
 */
export function billableFromDay(
  today: string,
  lastPostedRent: string | null,
): string {
  if (lastPostedRent === null) return today;
  const dayAfter = addDays(lastPostedRent, 1);
  return dayAfter > today ? dayAfter : today;
}

/** A signed contract as the rent schedule needs it. */
export type BillableContract = Pick<
  ContractForLedger,
  "driverId" | "schedule" | "totalRateCents" | "startDate"
> & {
  /** When firma says it was signed; breaks a tie between two contracts with the same start date. */
  signedAt: Date | null;
  /**
   * True for a charge set by hand (D100): its start date is its first rent and the job posts it. A signed contract leaves
   * it out (false): its first rent is posted at signing. Optional, so everything built before D100 still works unchanged.
   */
  billsStartDate?: boolean;
};

/**
 * Every rent debit the job should have posted for a driver by `today`, from all their signed contracts: each due date is
 * billed by the contract in force on that day. A contract bills from its start date (the first rent is posted at signing)
 * until the day before the next contract's start date, where that contract's own first rent takes over, so a rate change
 * never leaves a gap or bills a day twice. Two contracts with the same start date: the one signed last bills. Dates before
 * `from` and after `today` are left out (see `rentDueDates`).
 */
export function rentSchedule(
  contracts: BillableContract[],
  from: string,
  today: string,
): SystemDebit[] {
  const sorted = [...contracts].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0),
  );
  // One contract per start date: the one signed last (it comes last after the sort).
  const inForce = sorted.filter(
    (contract, i) => sorted[i + 1]?.startDate !== contract.startDate,
  );
  return inForce.flatMap((contract, i) => {
    const endsBefore = inForce[i + 1]?.startDate ?? null;
    return rentDueDates(
      contract.startDate,
      contract.schedule,
      from,
      today,
      contract.billsStartDate ?? false,
    )
      .filter((day) => endsBefore === null || day < endsBefore)
      .map((day) => rentDebit(contract, day));
  });
}
