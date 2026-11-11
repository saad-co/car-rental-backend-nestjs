import {
  addDays,
  BUSINESS_TIME_ZONE,
  daysBetween,
} from "../common/chicago-date.js";
import { weekdayIndex } from "./dashboard.service.js";

/**
 * The periods of the collections views (Dashboard page 2, D93) as pure functions: no database, no clock. A period is a
 * month, a week (Monday to Sunday) or a day, written as the Chicago calendar day it starts on (`YYYY-MM-DD`). Everything
 * here is calendar arithmetic on those day strings, where every day has 24 hours, so a daylight-saving change can never
 * skip or repeat a period. The service asks Postgres for the money of each period and fills the quiet ones with 0.
 */

/** The three ways to group collections: one row per month, per Monday-to-Sunday week, or per day. */
export const COLLECTION_VIEWS = ["monthly", "weekly", "daily"] as const;
export type CollectionView = (typeof COLLECTION_VIEWS)[number];

/** The first day of the period that contains `day`: the 1st of its month, its Monday, or the day itself. */
export function periodStart(view: CollectionView, day: string): string {
  if (view === "monthly") return `${day.slice(0, 7)}-01`;
  if (view === "weekly") return addDays(day, -weekdayIndex(day));
  return day;
}

/**
 * The period that starts `count` periods after `start` (negative: before). `start` must be a period start. Months are
 * counted as calendar months, so a year boundary is just 12 of them; weeks are 7 days.
 */
export function shiftPeriod(
  view: CollectionView,
  start: string,
  count: number,
): string {
  if (view === "monthly") {
    const [y, m] = start.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + count, 1)).toISOString().slice(0, 10);
  }
  return addDays(start, view === "weekly" ? count * 7 : count);
}

/** The last day of the period that starts on `start` (inclusive): the end of the month, Sunday, or the day itself. */
export function periodEnd(view: CollectionView, start: string): string {
  return addDays(shiftPeriod(view, start, 1), -1);
}

/** How many periods there are from `firstStart` to `lastStart`, both included (both must be period starts). */
export function periodCount(
  view: CollectionView,
  firstStart: string,
  lastStart: string,
): number {
  if (lastStart < firstStart) return 0;
  if (view === "monthly") {
    const [fy, fm] = firstStart.split("-").map(Number);
    const [ly, lm] = lastStart.split("-").map(Number);
    return (ly - fy) * 12 + (lm - fm) + 1;
  }
  const days = daysBetween(firstStart, lastStart);
  return (view === "weekly" ? days / 7 : days) + 1;
}

/**
 * The starts of the periods on one page, newest first. The series runs from `oldestStart` to `newestStart`; page 1 begins
 * at the newest. A page past the end is an empty list.
 */
export function periodStartsOnPage(
  view: CollectionView,
  oldestStart: string,
  newestStart: string,
  page: number,
  limit: number,
): string[] {
  const total = periodCount(view, oldestStart, newestStart);
  const first = (page - 1) * limit;
  const last = Math.min(total, page * limit);
  const starts: string[] = [];
  for (let i = first; i < last; i++) {
    starts.push(shiftPeriod(view, newestStart, -i));
  }
  return starts;
}

/** The Chicago calendar day of a payment time column, worked out by Postgres (daylight saving included). */
export function chicagoDaySql(column: string): string {
  return `(${column} AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date`;
}

/**
 * The `AND ...` text that keeps the rows whose Chicago day is within `from`..`to` (inclusive, either optional), and pushes
 * the day values onto `params`. The same days `GET /payments?from&to` keeps, so a total here always matches the list.
 * Only `$n` placeholders go into the text; the days themselves travel as parameters.
 */
export function dayRangeSql(
  column: string,
  range: { from?: string; to?: string },
  params: unknown[],
): string {
  let sql = "";
  const day = chicagoDaySql(column);
  if (range.from) {
    params.push(range.from);
    sql += ` AND ${day} >= $${params.length}::date`;
  }
  if (range.to) {
    params.push(range.to);
    sql += ` AND ${day} <= $${params.length}::date`;
  }
  return sql;
}
