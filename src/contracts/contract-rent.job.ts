import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { chicagoDate } from "../common/chicago-date.js";
import { Driver, DriverStatus } from "../drivers/driver.entity.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { rentSchedule, type BillableContract } from "./contract-ledger.js";

/** Key of the Postgres advisory lock that lets only one run work at a time. Any fixed number works. */
const LOCK_KEY = 7_302_004;

export interface RentSummary {
  /** Active drivers with a signed contract that this run looked at. */
  checked: number;
  /** Rent entries written (the ones that already existed are not counted). */
  posted: number;
  /** Drivers whose posting failed: logged, and tried again next run. */
  failed: number;
}

/**
 * Bills rent from the signed contract (Module 2 step 5, D83). Every hour, for each `active`, not archived driver with a signed
 * contract: the rent of every due date from the contract's start date + one period up to today in Chicago, never before the
 * driver's `rent_from` day (the day they last became active, so a gap while they were inactive or archived is never billed). Each due date is one debit with the unique key `rent:<driverId>:<date>`, so running twice, two runs at once, a
 * restart or catching up after downtime writes each date exactly once, and the first rent posted at signing is never repeated.
 *
 * The contract is the source of the rate, schedule and start date (they cannot change after sending, D74): each due date is
 * billed by the signed contract in force that day, so a newer contract takes over on its own start date. Drivers who are
 * onboarding, inactive or archived, or have no signed contract (the imported ones), are never billed here. The contract auto-extends weekly, so there is no end date: billing stops when the driver is deactivated.
 */
@Injectable()
export class ContractRentJob {
  private readonly logger = new Logger(ContractRentJob.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /** `waitForCompletion`: a tick never starts while the previous one still runs. */
  @Cron("0 0 * * * *", { name: "contract-rent", waitForCompletion: true })
  async tick(): Promise<void> {
    try {
      const result = await this.run();
      if (result && (result.posted > 0 || result.failed > 0)) {
        this.logger.log(
          `Contract rent: ${result.checked} drivers checked, ${result.posted} rent entries posted, ${result.failed} failed`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Contract rent run failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** One run for the Chicago day of `now`. Returns null when another run holds the lock. */
  async run(now: Date = new Date()): Promise<RentSummary | null> {
    // An advisory lock belongs to one database connection, so take, use and release it on the same one.
    const lockConnection = this.dataSource.createQueryRunner();
    await lockConnection.connect();
    try {
      const [{ locked }] = (await lockConnection.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [LOCK_KEY],
      )) as [{ locked: boolean }];
      if (!locked) return null;
      try {
        return await this.work(chicagoDate(now));
      } finally {
        await lockConnection.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      await lockConnection.release();
    }
  }

  private async work(today: string): Promise<RentSummary> {
    const summary: RentSummary = { checked: 0, posted: 0, failed: 0 };
    const drivers = (await this.dataSource.query(
      `SELECT DISTINCT d.id
       FROM drivers d JOIN contracts c ON c.driver_id = d.id
       WHERE d.status = 'active' AND d.archived_at IS NULL AND d.rent_from IS NOT NULL AND c.status = 'signed'
       ORDER BY d.id`,
    )) as { id: string }[];

    for (const { id: driverId } of drivers) {
      summary.checked++;
      try {
        summary.posted += await this.billDriver(driverId, today);
      } catch (error) {
        // One driver's failure never stops the others; it is counted, logged with the driver id, and retried next run.
        summary.failed++;
        this.logger.error(
          `Rent for driver ${driverId} could not be posted: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return summary;
  }

  /**
   * Posts the missing rent of one driver in one transaction. The driver row is locked first (deactivating a driver and
   * signing a new contract lock it too), and the driver's status and signed contracts are read again under that lock,
   * so a driver deactivated or re-contracted a moment ago is billed by what is true now.
   * @returns how many entries were written.
   */
  private async billDriver(driverId: string, today: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const driver = await manager.findOne(Driver, {
        where: { id: driverId },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !driver ||
        driver.status !== DriverStatus.active ||
        driver.archivedAt !== null ||
        driver.rentFrom === null
      ) {
        return 0;
      }

      // Every signed contract of the driver: each due date is billed by the contract in force that day (`rentSchedule`).
      const contracts = (await manager.query(
        `SELECT driver_id AS "driverId", schedule, total_rate_cents AS "totalRateCents", start_date::text AS "startDate",
                signed_at AS "signedAt"
         FROM contracts
         WHERE driver_id = $1 AND status = 'signed'`,
        [driverId],
      )) as BillableContract[];
      const debits = rentSchedule(contracts, driver.rentFrom, today);
      return this.ledger.postSystemDebits(manager, driverId, debits);
    });
  }
}
