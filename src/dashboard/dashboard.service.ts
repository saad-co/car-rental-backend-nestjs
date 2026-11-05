import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  addDays,
  BUSINESS_TIME_ZONE,
  chicagoDate,
} from "../common/chicago-date.js";
import {
  rentSchedule,
  type BillableContract,
} from "../contracts/contract-ledger.js";
import { ContractSchedule } from "../contracts/contract.entity.js";
import { SmsService } from "../sms/sms.service.js";
import {
  type DashboardApplicationsDto,
  type DashboardBalancesDto,
  type DashboardBillingDto,
  type DashboardDriversDto,
  type DashboardDto,
  type DashboardIntakeDto,
  type DashboardIntakeRunDto,
  type DashboardMailCountsDto,
  type DashboardPaymentsDto,
  type DashboardSmsDto,
  type DashboardSourceDto,
  type DashboardTrendDayDto,
  type DashboardWeekday,
  type DashboardWeekdayDto,
} from "./dto/dashboard.dto.js";
import type { PaymentSource } from "../payments/payment.entity.js";

/** Days in the revenue trend, today included. */
const TREND_DAYS = 21;
/** How many drivers the balance watchlist shows. */
const WATCHLIST_SIZE = 8;

/** The Chicago calendar day of a payment, worked out by Postgres (daylight saving included). */
const PAYMENT_DAY = `(occurred_at AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date`;

/** Monday first, the order the cards show. */
const WEEKDAYS: DashboardWeekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** `part` as a whole-number share of `whole`, 0-100; 0 when there is nothing to divide by. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Index of a Chicago day in `WEEKDAYS` (Monday = 0). Pure calendar maths in UTC, like `addDays`. */
export function weekdayIndex(day: string): number {
  const sundayFirst = new Date(`${day}T00:00:00Z`).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/**
 * The signed contract in force on `day`: the one with the latest start date that is not after `day`; two with the same
 * start date, the one signed last. The same choice `rentSchedule` makes when the rent job bills each due date.
 * `null` when none has started yet.
 */
export function contractInForce(
  contracts: BillableContract[],
  day: string,
): BillableContract | null {
  const started = contracts
    .filter((contract) => contract.startDate <= day)
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0),
    );
  return started.at(-1) ?? null;
}

/**
 * The admin dashboard (spec section 10, D88): one read-only query set, worked out on the server.
 *
 * Express comparison: this is a service a controller calls, like a function in `services/dashboard.js` that your route
 * handler imports. The difference is that Nest creates it once and hands it to whoever lists it in their constructor
 * (dependency injection), so no file imports it by hand.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly sms: SmsService,
  ) {}

  /** Everything the dashboard shows. `now` is only a parameter so a test can pick the clock. */
  async get(now: Date = new Date()): Promise<DashboardDto> {
    const today = chicagoDate(now);
    // Independent reads run side by side (like Promise.all over several Mongo queries); any failure fails the request.
    const [
      payments,
      trend,
      sources,
      driverFigures,
      balances,
      applications,
      intake,
      sms,
    ] = await Promise.all([
      this.payments(today),
      this.trend(today),
      this.sources(),
      this.activeDrivers(today),
      this.balances(),
      this.applications(),
      this.intake(now),
      this.smsFigures(now),
    ]);
    return {
      asOf: now,
      today,
      payments,
      trend,
      sources,
      drivers: driverFigures.drivers,
      billing: { ...driverFigures.billing, ...balances.owed },
      balances: balances.balances,
      applications,
      intake,
      sms,
    };
  }

  /** The confirmed-money tiles and the unmatched queue. */
  private async payments(today: string): Promise<DashboardPaymentsDto> {
    const weekStart = addDays(today, -weekdayIndex(today));
    const [confirmed] = (await this.db.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS gross,
              COUNT(*)::int AS count,
              COALESCE(MAX(amount_cents), 0)::bigint AS largest,
              COALESCE(SUM(amount_cents) FILTER (WHERE day = $1::date), 0)::bigint AS today,
              COALESCE(SUM(amount_cents) FILTER (WHERE day BETWEEN $2::date AND $1::date), 0)::bigint AS last7,
              COALESCE(SUM(amount_cents) FILTER (WHERE day BETWEEN $3::date AND $1::date), 0)::bigint AS last30,
              COALESCE(SUM(amount_cents) FILTER (WHERE day BETWEEN $4::date AND $1::date), 0)::bigint AS week,
              (COUNT(*) FILTER (WHERE day BETWEEN $4::date AND $1::date))::int AS "weekCount"
       FROM (SELECT amount_cents, ${PAYMENT_DAY} AS day FROM payments WHERE status = 'confirmed') p`,
      [today, addDays(today, -6), addDays(today, -29), weekStart],
    )) as Record<string, string | number>[];
    const [queue] = (await this.db.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS cents,
              COUNT(*)::int AS count,
              (COUNT(*) FILTER (WHERE driver_id IS NULL AND match_attempted_at IS NOT NULL))::int AS "needsReview"
       FROM payments WHERE status = 'unmatched'`,
    )) as Record<string, string | number>[];

    const grossCount = Number(confirmed.count);
    const gross = Number(confirmed.gross);
    const queueCount = Number(queue.count);
    return {
      processedCents: gross + Number(queue.cents),
      processedCount: grossCount + queueCount,
      grossCents: gross,
      grossCount,
      matchedPercent: percent(grossCount, grossCount + queueCount),
      queueCents: Number(queue.cents),
      queueCount,
      needsReviewCount: Number(queue.needsReview),
      todayCents: Number(confirmed.today),
      last7DaysCents: Number(confirmed.last7),
      last30DaysCents: Number(confirmed.last30),
      thisWeekCents: Number(confirmed.week),
      thisWeekCount: Number(confirmed.weekCount),
      averageCents: grossCount > 0 ? Math.round(gross / grossCount) : 0,
      largestCents: Number(confirmed.largest),
    };
  }

  /** The last 21 Chicago days of confirmed money, quiet days filled with 0. */
  private async trend(today: string): Promise<DashboardTrendDayDto[]> {
    const first = addDays(today, -(TREND_DAYS - 1));
    const rows = (await this.db.query(
      `SELECT day::text AS day, SUM(amount_cents)::bigint AS cents
       FROM (SELECT amount_cents, ${PAYMENT_DAY} AS day FROM payments WHERE status = 'confirmed') p
       WHERE day BETWEEN $1::date AND $2::date
       GROUP BY day`,
      [first, today],
    )) as { day: string; cents: string }[];
    const byDay = new Map(rows.map((row) => [row.day, Number(row.cents)]));
    return Array.from({ length: TREND_DAYS }, (_, i) => {
      const day = addDays(first, i);
      return { day, amountCents: byDay.get(day) ?? 0 };
    });
  }

  /** Confirmed money and unmatched payments per source, biggest first. */
  private async sources(): Promise<DashboardSourceDto[]> {
    const rows = (await this.db.query(
      `SELECT source,
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS cents,
              (COUNT(*) FILTER (WHERE status = 'confirmed'))::int AS count,
              (COUNT(*) FILTER (WHERE status = 'unmatched'))::int AS unmatched
       FROM payments WHERE status IN ('confirmed', 'unmatched')
       GROUP BY source`,
    )) as {
      source: PaymentSource;
      cents: string;
      count: number;
      unmatched: number;
    }[];
    const total = rows.reduce((sum, row) => sum + Number(row.cents), 0);
    return rows
      .map((row) => ({
        source: row.source,
        amountCents: Number(row.cents),
        count: Number(row.count),
        unmatchedCount: Number(row.unmatched),
        sharePercent: percent(Number(row.cents), total),
      }))
      .sort(
        (a, b) =>
          b.amountCents - a.amountCents || a.source.localeCompare(b.source),
      );
  }

  /**
   * Active drivers by contract schedule, the weekly due-day spread and the rent due today. The rent due today is asked
   * of `rentSchedule`, the function the hourly rent job posts with, so this card can never disagree with the billing.
   */
  private async activeDrivers(
    today: string,
  ): Promise<{ drivers: DashboardDriversDto; billing: BillingToday }> {
    const rows = (await this.db.query(
      `SELECT d.id AS "driverId", d.rent_from::text AS "rentFrom",
              c.schedule, c.total_rate_cents AS "totalRateCents",
              c.start_date::text AS "startDate", c.signed_at AS "signedAt"
       FROM drivers d
       LEFT JOIN contracts c ON c.driver_id = d.id AND c.status = 'signed'
       WHERE d.status = 'active' AND d.archived_at IS NULL`,
    )) as {
      driverId: string;
      rentFrom: string | null;
      schedule: ContractSchedule | null;
      totalRateCents: number | null;
      startDate: string | null;
      signedAt: Date | null;
    }[];

    // Group the rows by driver: a driver has one row per signed contract (or one row with null columns: none).
    const byDriver = new Map<
      string,
      { rentFrom: string | null; contracts: BillableContract[] }
    >();
    for (const row of rows) {
      const entry = byDriver.get(row.driverId) ?? {
        rentFrom: row.rentFrom,
        contracts: [],
      };
      if (row.schedule && row.startDate && row.totalRateCents !== null) {
        entry.contracts.push({
          driverId: row.driverId,
          schedule: row.schedule,
          totalRateCents: row.totalRateCents,
          startDate: row.startDate,
          signedAt: row.signedAt,
        });
      }
      byDriver.set(row.driverId, entry);
    }

    const weeklyByDay: DashboardWeekdayDto[] = WEEKDAYS.map((weekday) => ({
      weekday,
      drivers: 0,
      expectedCents: 0,
    }));
    let daily = 0;
    let weekly = 0;
    let withoutContract = 0;
    const due = {
      dailyCents: 0,
      weeklyCents: 0,
      dailyDrivers: 0,
      weeklyDrivers: 0,
    };

    for (const { rentFrom, contracts } of byDriver.values()) {
      const inForce = contractInForce(contracts, today);
      if (!inForce) {
        withoutContract++;
        continue;
      }
      const isWeekly = inForce.schedule === ContractSchedule.weekly;
      if (isWeekly) {
        weekly++;
        const slot = weeklyByDay[weekdayIndex(inForce.startDate)];
        slot.drivers++;
        slot.expectedCents += inForce.totalRateCents;
      } else {
        daily++;
      }
      // Billed only from `rent_from` on (the job's rule); due today when the schedule has a due date today.
      if (rentFrom !== null && rentFrom <= today) {
        const dueToday = rentSchedule(contracts, today, today);
        if (dueToday.length > 0) {
          const cents = dueToday.reduce((sum, d) => sum + d.amountCents, 0);
          if (isWeekly) {
            due.weeklyCents += cents;
            due.weeklyDrivers++;
          } else {
            due.dailyCents += cents;
            due.dailyDrivers++;
          }
        }
      }
    }

    return {
      drivers: {
        active: byDriver.size,
        daily,
        weekly,
        withoutContract,
        dailyPercent: percent(daily, daily + weekly),
        weeklyPercent: percent(weekly, daily + weekly),
      },
      billing: {
        dueTodayCents: due.dailyCents + due.weeklyCents,
        dailyDueCents: due.dailyCents,
        weeklyDueCents: due.weeklyCents,
        dailyDueDrivers: due.dailyDrivers,
        weeklyDueDrivers: due.weeklyDrivers,
        weeklyByDay,
      },
    };
  }

  /**
   * Ledger balances (credits minus debits) of active and inactive drivers who are not archived: onboarding drivers are
   * not "drivers" yet (D81) and archived ones are hidden everywhere (D80). Drivers in collections are counted, the money
   * is still owed. One grouped query for all of them, not one per driver.
   */
  private async balances(): Promise<{
    balances: DashboardBalancesDto;
    owed: Pick<
      DashboardBillingDto,
      "inactiveOwedCents" | "collectionsOwedCents"
    >;
  }> {
    const rows = (await this.db.query(
      `SELECT d.id AS "driverId", d.first_name AS "firstName", d.last_name AS "lastName",
              d.status, (d.sent_to_collections_at IS NOT NULL) AS collections,
              COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END), 0)::bigint AS balance
       FROM drivers d LEFT JOIN ledger_entries e ON e.driver_id = d.id
       WHERE d.status IN ('active', 'inactive') AND d.archived_at IS NULL
       GROUP BY d.id`,
    )) as {
      driverId: string;
      firstName: string;
      lastName: string;
      status: string;
      collections: boolean;
      balance: string;
    }[];

    let fleet = 0;
    let credit = 0;
    let outstanding = 0;
    let positive = 0;
    let zero = 0;
    let negative = 0;
    let inactiveOwed = 0;
    let collectionsOwed = 0;
    for (const row of rows) {
      const balance = Number(row.balance);
      fleet += balance;
      if (balance > 0) {
        positive++;
        credit += balance;
      } else if (balance < 0) {
        negative++;
        outstanding += -balance;
        if (row.collections) collectionsOwed += -balance;
        else if (row.status === "inactive") inactiveOwed += -balance;
      } else {
        zero++;
      }
    }
    const watchlist = rows
      .filter((row) => Number(row.balance) < 0)
      .sort(
        (a, b) =>
          Number(a.balance) - Number(b.balance) ||
          a.lastName.localeCompare(b.lastName),
      )
      .slice(0, WATCHLIST_SIZE)
      .map((row) => ({
        driverId: row.driverId,
        name: `${row.firstName} ${row.lastName}`,
        balanceCents: Number(row.balance),
      }));

    return {
      balances: {
        driverCount: rows.length,
        fleetBalanceCents: fleet,
        positiveCount: positive,
        zeroCount: zero,
        negativeCount: negative,
        creditCents: credit,
        outstandingCents: outstanding,
        watchlist,
      },
      owed: {
        inactiveOwedCents: inactiveOwed,
        collectionsOwedCents: collectionsOwed,
      },
    };
  }

  /** Applications by status (archived left out) and drivers still onboarding. */
  private async applications(): Promise<DashboardApplicationsDto> {
    const rows = (await this.db.query(
      `SELECT status, COUNT(*)::int AS count FROM applications WHERE archived_at IS NULL GROUP BY status`,
    )) as { status: string; count: number }[];
    const count = (status: string) =>
      Number(rows.find((row) => row.status === status)?.count ?? 0);
    const [{ onboarding }] = (await this.db.query(
      `SELECT COUNT(*)::int AS onboarding FROM drivers WHERE status = 'onboarding' AND archived_at IS NULL`,
    )) as { onboarding: number }[];

    const approved = count("approved");
    const rejected = count("rejected");
    const onHold = count("on_hold");
    return {
      total: rows.reduce((sum, row) => sum + Number(row.count), 0),
      pending: count("pending"),
      approved,
      rejected,
      onHold,
      approvalPercent: percent(approved, approved + rejected + onHold),
      onboardingDrivers: Number(onboarding),
    };
  }

  /** What the mailbox stored in the last 24 hours and 7 days, and the payments waiting for the matcher. */
  private async intake(now: Date): Promise<DashboardIntakeDto> {
    const rows = (await this.db.query(
      `SELECT status,
              (COUNT(*) FILTER (WHERE created_at >= $1::timestamptz - interval '24 hours'))::int AS "last24Hours",
              COUNT(*)::int AS "last7Days"
       FROM inbound_emails
       WHERE created_at >= $1::timestamptz - interval '7 days'
       GROUP BY status`,
      [now.toISOString()],
    )) as { status: string; last24Hours: number; last7Days: number }[];
    const counts = (
      key: "last24Hours" | "last7Days",
    ): DashboardMailCountsDto => {
      const of = (status: string) =>
        Number(rows.find((row) => row.status === status)?.[key] ?? 0);
      return {
        processed: of("processed"),
        notPayment: of("not_payment"),
        rejectedUnverified: of("rejected_unverified"),
        extractionFailed: of("extraction_failed"),
        duplicatePayment: of("duplicate_payment"),
      };
    };
    const [{ lastEmailAt }] = (await this.db.query(
      `SELECT MAX(received_at) AS "lastEmailAt" FROM inbound_emails`,
    )) as { lastEmailAt: Date | null }[];
    const [{ waiting }] = (await this.db.query(
      `SELECT COUNT(*)::int AS waiting FROM payments WHERE status = 'unmatched' AND match_attempted_at IS NULL`,
    )) as { waiting: number }[];
    // The latest run, recorded by the scheduler (D88); no row yet on a new database.
    const [run] = (await this.db.query(
      `SELECT last_run_at AS "at", last_outcome AS outcome, last_stored AS stored,
              last_success_at AS "lastSuccessAt", last_error AS error
       FROM email_intake_status WHERE id = 1`,
    )) as {
      at: Date;
      outcome: DashboardIntakeRunDto["outcome"];
      stored: number;
      lastSuccessAt: Date | null;
      error: string | null;
    }[];
    return {
      lastRun: run
        ? {
            at: run.at,
            outcome: run.outcome,
            stored: Number(run.stored),
            lastSuccessAt: run.lastSuccessAt,
            error: run.error,
          }
        : null,
      last24Hours: counts("last24Hours"),
      last7Days: counts("last7Days"),
      lastEmailAt,
      awaitingMatchCount: Number(waiting),
    };
  }

  /** The SMS mode and settings plus the texts that failed in the last 7 days. */
  private async smsFigures(now: Date): Promise<DashboardSmsDto> {
    const { mode, quoConfigured } = this.sms.status();
    const [{ failed }] = (await this.db.query(
      `SELECT COUNT(*)::int AS failed FROM sms_messages
       WHERE direction = 'outbound' AND status IN ('failed', 'undelivered')
         AND occurred_at >= $1::timestamptz - interval '7 days'`,
      [now.toISOString()],
    )) as { failed: number }[];
    return { mode, quoConfigured, failedLast7Days: Number(failed) };
  }
}

/** The billing figures that come from the contracts (the owed amounts come from the balances). */
type BillingToday = Omit<
  DashboardBillingDto,
  "inactiveOwedCents" | "collectionsOwedCents"
>;
