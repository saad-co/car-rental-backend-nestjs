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

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. Pure UTC calendar arithmetic. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/** Formats an instant as its Chicago wall-clock parts (24-hour clock). */
const chicagoPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Chicago's offset from UTC at an instant, in milliseconds (negative: -6 h in winter, -5 h in summer). */
function chicagoOffsetMs(instant: number): number {
  const parts: Record<string, number> = {};
  for (const part of chicagoPartsFormatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which Chicago's wall clock shows `time` (`HH:MM`, 24 hours) on the Chicago day `day`. Example: 6 PM on
 * 2026-03-07 is 00:00 UTC on the 8th (CST, UTC-6), but 6 PM on 2026-03-08 is 23:00 UTC the same day (CDT, UTC-5), because
 * clocks went forward that night. A time that does not exist (2:30 AM on the spring-forward night) resolves to just
 * after the gap; one that happens twice (1:30 AM on the fall-back night) to the first.
 */
export function chicagoInstant(day: string, time: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hour, minute);
  // The offset depends on the instant, which is what we are looking for: guess with the offset at the wall time read as
  // UTC, then correct once with the offset at the guess. Daylight saving moves the offset by one hour at most.
  const guess = wallAsUtc - chicagoOffsetMs(wallAsUtc);
  const corrected = wallAsUtc - chicagoOffsetMs(guess);
  return new Date(corrected);
}
