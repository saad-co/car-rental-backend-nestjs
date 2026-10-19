import { LedgerAgingDto } from "./dto/ledger-read.dto.js";
import { LedgerDirection } from "./ledger-entry.entity.js";

/** One entry as aging needs it. Amounts are positive integer cents; `direction` says which way. */
export interface AgingEntry {
  direction: LedgerDirection;
  amountCents: number;
  /** The Chicago day the entry belongs to, `YYYY-MM-DD`. */
  effectiveDate: string;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). Pure calendar arithmetic in UTC: daylight saving can't matter. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/**
 * What the driver still owes, by the age of the charges (the aging tiles on the ledger page).
 *
 * First in, first out: all credits (payments, discounts) form one pool; the charges are walked oldest first and the
 * pool pays each off before moving to the next. What is left of a charge is "open" and counts in the bucket for its
 * age: 0 to 6 days, 7 to 13, 14 to 29, 30 or more. Whatever is left in the pool at the end is the driver being paid
 * ahead (a credit balance) and shows in no bucket. The buckets therefore always add up to `max(0, −balance)`.
 *
 * `entries` must already be in date order (oldest first, ties in the order they were recorded), and must not contain
 * a reversal or the entry it reversed: together they are zero, so leaving both out gives the same balance.
 * Integer cents only.
 */
export function ageBalance(
  entries: AgingEntry[],
  today: string,
): LedgerAgingDto {
  let pool = entries
    .filter((e) => e.direction === LedgerDirection.credit)
    .reduce((sum, e) => sum + e.amountCents, 0);

  const aging: LedgerAgingDto = {
    currentCents: 0,
    days7to13Cents: 0,
    days14to29Cents: 0,
    days30PlusCents: 0,
    pastDueCents: 0,
  };
  for (const charge of entries) {
    if (charge.direction !== LedgerDirection.debit) continue;
    const paid = Math.min(charge.amountCents, pool);
    pool -= paid;
    const open = charge.amountCents - paid;
    if (open === 0) continue;

    const age = daysBetween(charge.effectiveDate, today);
    if (age >= 30) aging.days30PlusCents += open;
    else if (age >= 14) aging.days14to29Cents += open;
    else if (age >= 7) aging.days7to13Cents += open;
    else aging.currentCents += open;
  }
  aging.pastDueCents =
    aging.days7to13Cents + aging.days14to29Cents + aging.days30PlusCents;
  return aging;
}
