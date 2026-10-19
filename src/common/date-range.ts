import { BadRequestException } from "@nestjs/common";
import type { ObjectLiteral, SelectQueryBuilder } from "typeorm";
import { BUSINESS_TIME_ZONE } from "./chicago-date.js";

/**
 * Limits a list to the rows whose time column falls on the days `from`..`to` (both `YYYY-MM-DD`, inclusive, either
 * optional), counted in the business's time zone (B82, D63).
 *
 * Why not compare with UTC midnight: a payment at 03:00 UTC on Oct 16 happened on the evening of Oct 15 in Chicago,
 * and that is the day the admin sees on screen. So the day's start is "midnight in Chicago", worked out by Postgres:
 * `CAST(:from AS date)` is the day, `::timestamp` its midnight with no zone, and `AT TIME ZONE 'America/Chicago'`
 * says which instant that midnight was in Chicago, daylight saving included. The end is the midnight after `to`,
 * excluded (`<`), so the whole last day counts. Mongo equivalent: `{ $gte: startOfDay, $lt: startOfNextDay }`, with
 * the boundaries worked out in the application instead of the database.
 *
 * @param column the time column as the query builder knows it, e.g. `p.occurredAt`.
 * @throws BadRequestException if `from` is later than `to`.
 */
export function addDateRange<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  column: string,
  range: { from?: string; to?: string },
): void {
  const { from, to } = range;
  // `YYYY-MM-DD` strings sort like dates, so a plain comparison is enough.
  if (from && to && from > to) {
    throw new BadRequestException(
      `The "from" date (${from}) is after the "to" date (${to}).`,
    );
  }
  if (from) {
    builder.andWhere(
      `${column} >= CAST(:rangeFrom AS date)::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}'`,
      { rangeFrom: from },
    );
  }
  if (to) {
    builder.andWhere(
      `${column} < (CAST(:rangeTo AS date) + 1)::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}'`,
      { rangeTo: to },
    );
  }
}
