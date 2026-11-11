import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { chicagoDate } from "../common/chicago-date.js";
import {
  chicagoDaySql,
  dayRangeSql,
  periodCount,
  periodEnd,
  periodStart,
  periodStartsOnPage,
  type CollectionView,
} from "./collections.js";
import {
  CollectionPeriodsDto,
  CollectionsQueryDto,
} from "./dto/collections.dto.js";
import { RevenueByDriverDto } from "./dto/revenue-by-driver.dto.js";
import type { DriverStatus } from "../drivers/driver.entity.js";
import type { DayRangeQueryDto } from "./dto/day-range-query.dto.js";

/** The `date_trunc` unit of each view; fixed text, never from the request. */
const TRUNC_UNIT: Record<CollectionView, string> = {
  monthly: "month",
  weekly: "week",
  daily: "day",
};

/** "A payment" in both Page 2 lists is a confirmed one: money that reached a driver's ledger (D49, D93). */
const CONFIRMED = "p.status = 'confirmed'";

/** Refuses a range that runs backwards, the way `GET /payments` does. */
function assertRange(range: { from?: string; to?: string }): void {
  if (range.from && range.to && range.from > range.to) {
    throw new BadRequestException(
      `The "from" date (${range.from}) is after the "to" date (${range.to}).`,
    );
  }
}

/**
 * The money received per month, week or day, and per driver (Dashboard page 2, D93). Read-only, plain SQL through the shared
 * connection like `DashboardService`: "collected" is the sum of the confirmed payments by the Chicago day they were received.
 * Voided payments (`rejected`) and the unmatched queue are not collected; a reassigned payment counts for its new driver.
 */
@Injectable()
export class CollectionsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * One page of periods, newest first, quiet ones as 0. `now` is only a parameter so a test can pick the clock.
   * The series runs from the period of `from` (or of the first payment) to the period of `to` (or today, never later).
   */
  async collections(
    query: CollectionsQueryDto,
    now: Date = new Date(),
  ): Promise<CollectionPeriodsDto> {
    const { view, page, limit } = query;
    assertRange(query);
    const today = chicagoDate(now);

    const params: unknown[] = [];
    const range = dayRangeSql("p.occurred_at", query, params);
    const [grand] = (await this.db.query(
      `SELECT COALESCE(SUM(p.amount_cents), 0)::bigint AS cents, COUNT(*)::int AS count,
              MIN(${chicagoDaySql("p.occurred_at")})::text AS "firstDay"
       FROM payments p WHERE ${CONFIRMED}${range}`,
      params,
    )) as { cents: string; count: number; firstDay: string | null }[];

    const newestDay = query.to && query.to < today ? query.to : today;
    const oldestDay = query.from ?? grand.firstDay;
    const base = {
      view,
      page,
      limit,
      totalCents: Number(grand.cents),
      paymentCount: Number(grand.count),
    };
    // No `from` and no payment at all: there is no first period to start from.
    if (!oldestDay) return { ...base, items: [], total: 0 };

    const oldest = periodStart(view, oldestDay);
    const newest = periodStart(view, newestDay);
    const starts = periodStartsOnPage(view, oldest, newest, page, limit);
    const total = periodCount(view, oldest, newest);
    if (starts.length === 0) return { ...base, items: [], total };

    // Only the days of this page's periods are read; the range is applied on top (a period cut by it holds its days inside).
    const pageParams: unknown[] = [];
    const pageRange = dayRangeSql("p.occurred_at", query, pageParams);
    pageParams.push(starts.at(-1), periodEnd(view, starts[0]));
    const rows = (await this.db.query(
      `SELECT date_trunc('${TRUNC_UNIT[view]}', day::timestamp)::date::text AS "periodStart",
              SUM(amount_cents)::bigint AS cents, COUNT(*)::int AS count
       FROM (SELECT p.amount_cents, ${chicagoDaySql("p.occurred_at")} AS day
             FROM payments p WHERE ${CONFIRMED}${pageRange}) d
       WHERE day >= $${pageParams.length - 1}::date AND day <= $${pageParams.length}::date
       GROUP BY 1`,
      pageParams,
    )) as { periodStart: string; cents: string; count: number }[];
    const byStart = new Map(rows.map((row) => [row.periodStart, row]));

    return {
      ...base,
      total,
      items: starts.map((start) => {
        const row = byStart.get(start);
        return {
          periodStart: start,
          periodEnd: periodEnd(view, start),
          totalCents: Number(row?.cents ?? 0),
          paymentCount: Number(row?.count ?? 0),
        };
      }),
    };
  }

  /** One page of drivers who received money in the range, biggest total first; the totals are those of the whole range. */
  async revenueByDriver(query: DayRangeQueryDto): Promise<RevenueByDriverDto> {
    const { page, limit } = query;
    assertRange(query);

    const params: unknown[] = [];
    const range = dayRangeSql("p.occurred_at", query, params);
    const [grand] = (await this.db.query(
      `SELECT COALESCE(SUM(p.amount_cents), 0)::bigint AS cents, COUNT(*)::int AS count,
              COUNT(DISTINCT p.driver_id)::int AS drivers
       FROM payments p WHERE ${CONFIRMED}${range}`,
      params,
    )) as { cents: string; count: number; drivers: number }[];

    const pageParams = [...params, limit, (page - 1) * limit];
    const rows = (await this.db.query(
      `SELECT d.id AS "driverId", d.first_name AS "firstName", d.last_name AS "lastName", d.status,
              (d.archived_at IS NOT NULL) AS archived,
              SUM(p.amount_cents)::bigint AS cents, COUNT(*)::int AS count, MAX(p.occurred_at) AS "lastPaymentAt"
       FROM payments p JOIN drivers d ON d.id = p.driver_id
       WHERE ${CONFIRMED}${range}
       GROUP BY d.id
       ORDER BY cents DESC, d.last_name, d.first_name, d.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    )) as {
      driverId: string;
      firstName: string;
      lastName: string;
      status: DriverStatus;
      archived: boolean;
      cents: string;
      count: number;
      lastPaymentAt: Date;
    }[];

    return {
      page,
      limit,
      total: Number(grand.drivers),
      totalCents: Number(grand.cents),
      paymentCount: Number(grand.count),
      items: rows.map((row) => ({
        driverId: row.driverId,
        name: `${row.firstName} ${row.lastName}`,
        status: row.status,
        archived: row.archived,
        totalCents: Number(row.cents),
        paymentCount: Number(row.count),
        lastPaymentAt: row.lastPaymentAt,
      })),
    };
  }
}
