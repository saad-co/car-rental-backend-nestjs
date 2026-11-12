import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { addDays, chicagoDate } from "../common/chicago-date.js";
import type { BillableContract } from "../contracts/contract-ledger.js";
import { ContractSchedule } from "../contracts/contract.entity.js";
import { DriverLeftReason, DriverStatus } from "../drivers/driver.entity.js";
import {
  LedgerDirection,
  LedgerEntryKind,
} from "../ledger/ledger-entry.entity.js";
import { contractInForce, weekdayIndex } from "./dashboard.service.js";
import {
  deactivationReasons,
  depositStatus,
  dueStatus,
  isEarlyWarning,
  isLate,
  minuteTime,
  openCharges,
  rentLateness,
  type DepositStatus,
  type LedgerLine,
  type Lateness,
  type OpenCharge,
} from "./daily-ops.js";
import {
  CollectionsDto,
  DailyOperationsDto,
  DepositsCollectedDto,
  DepositsPendingDto,
  DueTodayRowDto,
  LateDriverDto,
  ShouldBeDeactivatedRowDto,
  WeekTotalDto,
} from "./dto/daily-ops.dto.js";

/** The weeks the weekly total shows: the current one and the 25 before it. */
const WEEKS_SHOWN = 26;

/** A driver the lists are about: active or onboarding, not archived, not in collections. */
export interface ListedDriver {
  id: string;
  status: DriverStatus;
  /** The "Deposit paid" onboarding step is ticked (B106: ticking does not touch the ledger). */
  depositTicked: boolean;
  firstName: string;
  lastName: string;
  rentDueTime: string | null;
  onPaymentPlan: boolean;
  /** What the payment reminders need (Fleet revisions section 6). */
  phone: string;
  smsOptedOut: boolean;
  upcomingRemindersEnabled: boolean;
  balanceRemindersEnabled: boolean;
  /** The day billing starts (`YYYY-MM-DD`): rent is never billed or chased before it; null = not billed. */
  rentFrom: string | null;
  lateEpisodeStartedAt: Date | null;
}

/** A signed contract with the vehicle it names (the rent schedule needs the first columns). */
export interface ContractRow extends BillableContract {
  vehicleModel: string | null;
  vehiclePlate: string | null;
  securityDepositCents: number;
}

/** Everything the lists need to know about one driver, worked out once. */
export interface DriverFigures {
  driver: ListedDriver;
  name: string;
  /** The signed contract in force today, if any. */
  contract: ContractRow | null;
  charges: OpenCharge[];
  /** Ledger balance in cents: credits minus debits. */
  balanceCents: number;
  /** Rent lateness at `now`. */
  lateness: Lateness;
  /** The unpaid deposit of the driver's first signed contract that has one; null when nothing is owed. */
  deposit: DepositStatus | null;
  /** That deposit in cents (0 when no contract has one). */
  depositCents: number;
  /** The start date of that contract: the day the deposit is due; null without one. */
  depositDueDate: string | null;
}

/**
 * The daily operations page (Dashboard page 1, D92): who is due today, who is late, who is a full day late. Read-only and
 * computed when read, from the ledger and the signed contract (spec section 7): no flag is stored and no driver is ever
 * changed by this page.
 *
 * Express comparison: another service next to `DashboardService`, listed in the same module, that the controller calls.
 * Like it, it owns no table and reads the others with plain SQL through the shared connection.
 */
@Injectable()
export class DailyOperationsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Everything the page shows. `now` is only a parameter so a test can pick the clock. */
  async get(now: Date = new Date()): Promise<DailyOperationsDto> {
    const today = chicagoDate(now);
    const [figures, weeks, depositsCollected, collections] = await Promise.all([
      this.driverFigures(now),
      this.weeks(today),
      this.depositsCollected(),
      this.collections(),
    ]);
    // Rent is billed and chased for active drivers only (spec section 7); a driver still onboarding is on the page only
    // through the deposit rule.
    const active = figures.filter(
      (f) => f.driver.status === DriverStatus.active,
    );

    return {
      asOf: now,
      today,
      dueToday: this.dueToday(active, today, now),
      late: this.lateList(active.filter((f) => isLate(f.lateness))),
      earlyWarning: this.lateList(
        active.filter((f) => isEarlyWarning(f.lateness)),
      ),
      shouldBeDeactivated: this.shouldBeDeactivated(figures),
      weeks,
      depositsCollected,
      depositsPending: this.depositsPending(figures),
      collections,
    };
  }

  /**
   * The listed drivers (active or onboarding, not archived, not in collections) with their signed contracts and their
   * ledger, in three queries for all of them (not one per driver), then worked out in memory.
   */
  async driverFigures(now: Date, onlyIds?: string[]): Promise<DriverFigures[]> {
    const drivers = (await this.db.query(
      `SELECT id, status, first_name AS "firstName", last_name AS "lastName", rent_due_time::text AS "rentDueTime",
              on_payment_plan AS "onPaymentPlan", (deposit_paid_at IS NOT NULL) AS "depositTicked",
              phone, sms_opted_out AS "smsOptedOut", upcoming_reminders_enabled AS "upcomingRemindersEnabled",
              balance_reminders_enabled AS "balanceRemindersEnabled", rent_from::text AS "rentFrom",
              late_episode_started_at AS "lateEpisodeStartedAt"
       FROM drivers
       WHERE status IN ('active', 'onboarding') AND archived_at IS NULL AND sent_to_collections_at IS NULL
         AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))`,
      [onlyIds ?? null],
    )) as ListedDriver[];
    if (drivers.length === 0) return [];
    const ids = drivers.map((driver) => driver.id);

    const contracts = (await this.db.query(
      `SELECT driver_id AS "driverId", schedule, total_rate_cents AS "totalRateCents", start_date::text AS "startDate",
              signed_at AS "signedAt", vehicle_model AS "vehicleModel", vehicle_plate AS "vehiclePlate",
              security_deposit_cents AS "securityDepositCents"
       FROM contracts
       WHERE status = 'signed' AND driver_id = ANY($1::uuid[])`,
      [ids],
    )) as ContractRow[];
    const contractsByDriver = groupBy(contracts, (row) => row.driverId);

    // The same lines the ledger page's aging reads: a reversal and the entry it cancels are both left out (together they
    // are zero), oldest first, ties in the order they were recorded.
    const lines = (await this.db.query(
      `SELECT e.driver_id AS "driverId", e.id, e.direction, e.kind, e.amount_cents AS "amountCents",
              e.effective_date::text AS "effectiveDate"
       FROM ledger_entries e
       WHERE e.driver_id = ANY($1::uuid[]) AND e.kind <> 'reversal'
         AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of_id = e.id)
       ORDER BY e.driver_id, e.effective_date, e.created_at, e.entry_no`,
      [ids],
    )) as (LedgerLine & { driverId: string })[];
    const linesByDriver = groupBy(lines, (row) => row.driverId);

    const today = chicagoDate(now);
    return drivers.map((driver) => {
      const rentDueTime = minuteTime(driver.rentDueTime);
      const driverLines = linesByDriver.get(driver.id) ?? [];
      const charges = openCharges(driverLines);
      const signed = contractsByDriver.get(driver.id) ?? [];
      // The deposit is the one the first signed contract that has one asks for, due on its start date (D92).
      const depositContract = [...signed]
        .filter((contract) => contract.securityDepositCents > 0)
        .sort(
          (a, b) =>
            a.startDate.localeCompare(b.startDate) ||
            (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0),
        )[0];
      return {
        driver: { ...driver, rentDueTime },
        name: `${driver.firstName} ${driver.lastName}`,
        contract: contractInForce(signed, today),
        charges,
        balanceCents: driverLines.reduce(
          (sum, line) =>
            sum +
            (line.direction === LedgerDirection.credit
              ? line.amountCents
              : -line.amountCents),
          0,
        ),
        lateness: rentLateness(charges, rentDueTime, now),
        deposit: depositContract
          ? depositStatus(
              {
                depositCents: depositContract.securityDepositCents,
                ticked: driver.depositTicked,
                startDate: depositContract.startDate,
              },
              today,
            )
          : null,
        depositCents: depositContract?.securityDepositCents ?? 0,
        depositDueDate: depositContract?.startDate ?? null,
      };
    });
  }

  /**
   * Payments due today (D1): the driver has a rent charge dated today. The hourly rent job posts it shortly after midnight
   * (Chicago), and the first rent is posted at signing dated the start date. Weekly first, then daily, then by name.
   */
  private dueToday(
    figures: DriverFigures[],
    today: string,
    now: Date,
  ): DueTodayRowDto[] {
    const rows: DueTodayRowDto[] = [];
    for (const f of figures) {
      const charge = f.charges.find(
        (c) => c.kind === LedgerEntryKind.rent && c.effectiveDate === today,
      );
      if (!charge) continue;
      rows.push({
        driverId: f.driver.id,
        name: f.name,
        vehicle: vehicleLabel(f.contract),
        schedule: f.contract?.schedule ?? null,
        rateCents: f.contract?.totalRateCents ?? null,
        dueTime: f.driver.rentDueTime,
        amountDueCents: charge.amountCents,
        openCents: charge.openCents,
        status: dueStatus(charge, f.driver.rentDueTime, now),
        onPaymentPlan: f.driver.onPaymentPlan,
      });
    }
    const order = (row: DueTodayRowDto) =>
      row.schedule === ContractSchedule.weekly
        ? 0
        : row.schedule === ContractSchedule.daily
          ? 1
          : 2;
    return rows.sort(
      (a, b) => order(a) - order(b) || a.name.localeCompare(b.name),
    );
  }

  /**
   * Should Be Deactivated (D4): drivers who meet a rule and are not on a payment plan. The rent rules apply to active
   * drivers only; the deposit rule also to a driver still onboarding (an active driver has the deposit step ticked, the
   * database requires it). Only shows: nothing here ever changes a driver.
   */
  private shouldBeDeactivated(
    figures: DriverFigures[],
  ): ShouldBeDeactivatedRowDto[] {
    const rows: ShouldBeDeactivatedRowDto[] = [];
    for (const f of figures) {
      const isActive = f.driver.status === DriverStatus.active;
      const reasons = deactivationReasons({
        schedule: f.contract?.schedule ?? null,
        // No late-rent rule for a driver who is not active yet: their rent is not billed or chased.
        lateness: isActive
          ? f.lateness
          : { lateCharges: [], pastDueCents: 0, oldest: null },
        deposit: f.deposit,
        onPaymentPlan: f.driver.onPaymentPlan,
      });
      if (reasons.length === 0) continue;
      const depositListed = reasons.includes("deposit_unpaid");
      rows.push({
        driverId: f.driver.id,
        name: f.name,
        schedule: f.contract?.schedule ?? null,
        driverStatus: f.driver.status,
        reasons,
        balanceCents: f.balanceCents,
        daysLate: isActive ? (f.lateness.oldest?.daysLate ?? 0) : 0,
        depositDaysSinceDue: depositListed
          ? (f.deposit?.daysSinceDue ?? null)
          : null,
        depositCents: depositListed ? f.depositCents : null,
      });
    }
    // Longest overdue first (rent days or deposit days), then who owes most, then by name.
    const overdue = (row: ShouldBeDeactivatedRowDto) =>
      Math.max(row.daysLate, row.depositDaysSinceDue ?? 0);
    return rows.sort(
      (a, b) =>
        overdue(b) - overdue(a) ||
        a.balanceCents - b.balanceCents ||
        a.name.localeCompare(b.name),
    );
  }

  /**
   * The weekly totals (D5, D22, D23): confirmed payments (the same money the dashboard counts, D88) grouped by the Chicago
   * day they came in, into Monday-to-Sunday weeks, the current week and the 25 before it, newest first. Postgres'
   * `date_trunc('week', ...)` starts a week on Monday. A quiet week is a row of 0. The client wrote "12:01 AM Monday to
   * Sunday midnight": the weeks here are whole Chicago days, a minute's difference.
   */
  private async weeks(today: string): Promise<WeekTotalDto[]> {
    const currentMonday = addDays(today, -weekdayIndex(today));
    const firstMonday = addDays(currentMonday, -7 * (WEEKS_SHOWN - 1));
    const rows = (await this.db.query(
      `SELECT date_trunc('week', day::timestamp)::date::text AS "weekStart",
              SUM(amount_cents)::bigint AS cents, COUNT(*)::int AS count
       FROM (SELECT amount_cents, (occurred_at AT TIME ZONE 'America/Chicago')::date AS day
             FROM payments WHERE status = 'confirmed') p
       WHERE day >= $1::date AND day <= $2::date
       GROUP BY 1`,
      [firstMonday, addDays(currentMonday, 6)],
    )) as { weekStart: string; cents: string; count: number }[];
    const byWeek = new Map(rows.map((row) => [row.weekStart, row]));
    return Array.from({ length: WEEKS_SHOWN }, (_, i) => {
      const weekStart = addDays(currentMonday, -7 * i);
      const row = byWeek.get(weekStart);
      return {
        weekStart,
        weekEnd: addDays(weekStart, 6),
        totalCents: Number(row?.cents ?? 0),
        paymentCount: Number(row?.count ?? 0),
      };
    });
  }

  /**
   * Deposits collected (D6): every driver, not archived, whose "Deposit paid" step is ticked, with the amount typed then
   * (D82). The step does not touch the ledger (B106), so this is a record of what staff ticked, not a ledger sum. A step
   * ticked before amounts were recorded has none: listed, not added into the total.
   */
  private async depositsCollected(): Promise<DepositsCollectedDto> {
    const rows = (await this.db.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", deposit_paid_at AS "paidAt",
              deposit_paid_cents AS "amountCents"
       FROM drivers
       WHERE deposit_paid_at IS NOT NULL AND archived_at IS NULL
       ORDER BY deposit_paid_at DESC, last_name, first_name`,
    )) as {
      id: string;
      firstName: string;
      lastName: string;
      paidAt: Date;
      amountCents: number | null;
    }[];
    return {
      totalCents: rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0),
      withoutAmountCount: rows.filter((row) => row.amountCents === null).length,
      drivers: rows.map((row) => ({
        driverId: row.id,
        name: `${row.firstName} ${row.lastName}`,
        amountCents: row.amountCents,
        paidAt: row.paidAt,
      })),
    };
  }

  /**
   * Deposits pending (D7): the contract asks for a deposit and the step is not ticked. The amount is the contract's
   * deposit; the due day is the contract start date (D92). Longest overdue first.
   */
  private depositsPending(figures: DriverFigures[]): DepositsPendingDto {
    const drivers = figures
      .filter((f) => f.deposit !== null && f.depositDueDate !== null)
      .map((f) => ({
        driverId: f.driver.id,
        name: f.name,
        amountCents: f.depositCents,
        dueDate: f.depositDueDate as string,
        daysSinceDue: f.deposit?.daysSinceDue ?? 0,
        overdue: f.deposit?.overdue ?? false,
        onPaymentPlan: f.driver.onPaymentPlan,
      }))
      .sort(
        (a, b) =>
          b.daysSinceDue - a.daysSinceDue || a.name.localeCompare(b.name),
      );
    return {
      totalCents: drivers.reduce((sum, row) => sum + row.amountCents, 0),
      drivers,
    };
  }

  /**
   * Drivers in collections (D9): the existing Collections feature (D81), only surfaced here. Not archived. One grouped
   * query for the balances. Most owed first.
   */
  private async collections(): Promise<CollectionsDto> {
    const rows = (await this.db.query(
      `SELECT d.id, d.first_name AS "firstName", d.last_name AS "lastName",
              d.sent_to_collections_at AS "sentAt", d.left_reason AS "leftReason",
              COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_cents ELSE -e.amount_cents END), 0)::bigint AS balance
       FROM drivers d LEFT JOIN ledger_entries e ON e.driver_id = d.id
       WHERE d.sent_to_collections_at IS NOT NULL AND d.archived_at IS NULL
       GROUP BY d.id`,
    )) as {
      id: string;
      firstName: string;
      lastName: string;
      sentAt: Date;
      leftReason: DriverLeftReason | null;
      balance: string;
    }[];
    const drivers = rows
      .map((row) => ({
        driverId: row.id,
        name: `${row.firstName} ${row.lastName}`,
        balanceCents: Number(row.balance),
        sentToCollectionsAt: row.sentAt,
        leftReason: row.leftReason,
      }))
      .sort(
        (a, b) =>
          a.balanceCents - b.balanceCents || a.name.localeCompare(b.name),
      );
    return {
      totalOwedCents: drivers.reduce(
        (sum, row) => sum + Math.max(0, -row.balanceCents),
        0,
      ),
      drivers,
    };
  }

  /** The rows of a late list: longest late first, then the most owed, then by name. */
  private lateList(figures: DriverFigures[]): LateDriverDto[] {
    return figures
      .map((f) => ({
        driverId: f.driver.id,
        name: f.name,
        schedule: f.contract?.schedule ?? null,
        dueTime: f.driver.rentDueTime,
        pastDueCents: f.lateness.pastDueCents,
        lateCount: f.lateness.lateCharges.length,
        daysLate: f.lateness.oldest?.daysLate ?? 0,
        hoursLate: f.lateness.oldest?.hoursLate ?? 0,
        onPaymentPlan: f.driver.onPaymentPlan,
      }))
      .sort(
        (a, b) =>
          b.hoursLate - a.hoursLate ||
          b.pastDueCents - a.pastDueCents ||
          a.name.localeCompare(b.name),
      );
  }
}

/** "Model (PLATE)", or whichever part the contract has; null when it names neither. */
function vehicleLabel(contract: ContractRow | null): string | null {
  if (!contract) return null;
  const model = contract.vehicleModel?.trim();
  const plate = contract.vehiclePlate?.trim();
  if (model && plate) return `${model} (${plate})`;
  return model || plate || null;
}

/** Groups rows by a key, keeping their order. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row)) ?? [];
    group.push(row);
    groups.set(key(row), group);
  }
  return groups;
}
