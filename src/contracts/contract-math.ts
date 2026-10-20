/**
 * The contract's numbers, calculated from what the admin types (Module 2 step 1, D71). Pure functions, integer cents
 * only (spec rule 1): nothing here touches the database, so the same code serves the live preview and the saved draft.
 */

/** Basis points (1/100 of a percent) of the total rate for each calculated line, from the client's Illinois sheet. */
const INSURANCE_BP = 3000;
const MILES_BP = 1300;
const MAINTENANCE_BP = 1000;
const TAX_BP = 500;

/** The five lines of the rate disclosure; together they always add up to the total rate. */
export interface RateBreakdown {
  /** Base rate (42%): what is left after the other four, so the lines add up exactly. */
  baseCents: number;
  /** Insurance (30%). */
  insuranceCents: number;
  /** Unlimited miles package (13%). */
  milesCents: number;
  /** Full maintenance package (10%). */
  maintenanceCents: number;
  /** Taxes (5%). */
  taxCents: number;
}

/** What the admin types for a contract (cents are whole cents; `startDate` is a `YYYY-MM-DD` day). */
export interface ContractMathInput {
  totalRateCents: number;
  startDate: string;
  termMonths: number;
  securityDepositCents: number;
  documentationFeeCents: number;
  insuranceStartFeeCents: number;
  otherOneTimeCents: number;
  holdVehicleCents: number;
  excessMileageCents: number;
  insuranceExcessCents: number;
  otherRecurringCents: number;
}

/** Everything the contract's disclosure shows that is not typed. */
export interface ContractNumbers extends RateBreakdown {
  /** The weekly or daily payment: equal to the total rate (our reading, D71). */
  paymentCents: number;
  /** The sum of the five one-time charges. */
  oneTimeTotalCents: number;
  /** First payment + one-time charges (our reading, D71). */
  amountDueAtPickupCents: number;
  /** The sheet's recurring "Total" row: payment + excess mileage + insurance excess + other recurring. */
  recurringTotalCents: number;
  /** The day the term ends, `YYYY-MM-DD`. */
  endDate: string;
}

/** `total * bp / 10000`, rounded half up, in integers (no float ever holds a fraction of a cent). */
function percentOf(totalCents: number, basisPoints: number): number {
  return Math.floor((totalCents * basisPoints + 5000) / 10000);
}

/**
 * Splits the total rate into the five disclosure lines. Insurance, miles, maintenance and taxes are rounded half up
 * from their percentage; the base rate takes the remainder, so the lines always add up to the total (D71).
 */
export function rateBreakdown(totalCents: number): RateBreakdown {
  const insuranceCents = percentOf(totalCents, INSURANCE_BP);
  const milesCents = percentOf(totalCents, MILES_BP);
  const maintenanceCents = percentOf(totalCents, MAINTENANCE_BP);
  const taxCents = percentOf(totalCents, TAX_BP);
  return {
    baseCents:
      totalCents - insuranceCents - milesCents - maintenanceCents - taxCents,
    insuranceCents,
    milesCents,
    maintenanceCents,
    taxCents,
  };
}

/**
 * The start day plus whole months, on the same day of the month; a day the target month does not have becomes that
 * month's last day (2026-08-31 + 6 months = 2027-02-28). Pure calendar arithmetic in UTC.
 */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** All the calculated numbers of a contract (D71). */
export function contractNumbers(input: ContractMathInput): ContractNumbers {
  const paymentCents = input.totalRateCents;
  const oneTimeTotalCents =
    input.securityDepositCents +
    input.documentationFeeCents +
    input.insuranceStartFeeCents +
    input.otherOneTimeCents +
    input.holdVehicleCents;
  return {
    ...rateBreakdown(input.totalRateCents),
    paymentCents,
    oneTimeTotalCents,
    amountDueAtPickupCents: paymentCents + oneTimeTotalCents,
    recurringTotalCents:
      paymentCents +
      input.excessMileageCents +
      input.insuranceExcessCents +
      input.otherRecurringCents,
    endDate: addMonths(input.startDate, input.termMonths),
  };
}
