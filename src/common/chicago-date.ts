/** The business time zone: billing and ledger days are Chicago days (spec rule 4). */
export const BUSINESS_TIME_ZONE = "America/Chicago";

/** `en-CA` formats as `YYYY-MM-DD`; the time zone does the UTC → Chicago conversion, daylight saving included. */
const chicagoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The Chicago calendar day of an instant, as `YYYY-MM-DD`. Example: 2026-10-19T04:30Z is 11:30 PM on
 * 2026-10-18 in Chicago, so this returns `"2026-10-18"`.
 */
export function chicagoDate(instant: Date): string {
  return chicagoFormatter.format(instant);
}

/** True for a real calendar day written as `YYYY-MM-DD` (refuses `2026-02-30` and `2026-1-5`). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Adds whole days to a `YYYY-MM-DD` day. Pure calendar arithmetic in UTC, where every day has 24 hours, so a
 * daylight-saving change can never skip or repeat a day.
 */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
