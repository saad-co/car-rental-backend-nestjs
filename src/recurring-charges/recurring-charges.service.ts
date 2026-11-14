import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { recordAudit } from "../audit/record-audit.js";
import { chicagoDate } from "../common/chicago-date.js";
import {
  billableFromDay,
  firstRentDate,
} from "../contracts/contract-ledger.js";
import { ContractRentJob } from "../contracts/contract-rent.job.js";
import type { ContractSchedule } from "../contracts/contract.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import {
  CreateRecurringChargeDto,
  DriverRecurringChargeDto,
  RecurringChargeDto,
  type RecurringChargeStatus,
} from "./dto/recurring-charge.dto.js";

/** A row of `driver_recurring_charges` as the queries below read it. */
interface ChargeRow {
  id: string;
  schedule: ContractSchedule;
  amountCents: number;
  firstDueDate: string;
  createdAt: Date;
  createdByEmail: string | null;
}

/** What a rent is, without who set it and when. */
type RentFacts = Pick<ChargeRow, "schedule" | "amountCents" | "firstDueDate">;

/** What the audit line keeps about a rent that was replaced or removed. */
const forAudit = (row: RentFacts) => ({
  schedule: row.schedule,
  amountCents: row.amountCents,
  firstDueDate: row.firstDueDate,
});

/**
 * The rent of a driver set by hand (D100) and changed by hand (D101). Rent is billed by the hourly rent job from the view
 * `billable_contracts`, which lists the signed contracts and these rows, so this service only records them: it never writes a
 * ledger entry itself except by calling the job's own idempotent per-driver method.
 *
 * One rule for everything, "rent from a date": the new rent starts on the first due day on or after the latest of the date the
 * admin picked, today and the day after the last rent already posted. Rows that already billed are never changed or deleted
 * (the older rent keeps billing until the day before, the same hand-over as a newer contract); rows that have not started yet
 * are replaced. The ledger entries already posted stay as they are: a typo there is fixed with the ledger's own edit (D94).
 *
 * Express comparison: the "model layer" a route handler calls. Nest creates one instance and injects it where it is listed in a
 * constructor.
 */
@Injectable()
export class RecurringChargesService {
  private readonly logger = new Logger(RecurringChargesService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly rentJob: ContractRentJob,
  ) {}

  /**
   * Every rent set by hand, newest first, each with where it is (`pending`, `current` or `past`), and the one in force today
   * (or, with none yet, the next one waiting to start). `now` is only a parameter so a test can pick the clock.
   * @throws NotFoundException unknown driver.
   */
  async get(
    driverId: string,
    now: Date = new Date(),
  ): Promise<DriverRecurringChargeDto> {
    const [driver] = (await this.db.query(
      `SELECT 1 FROM drivers WHERE id = $1`,
      [driverId],
    )) as unknown[];
    if (!driver) throw new NotFoundException("Driver not found.");
    const rows = (await this.db.query(
      `SELECT r.id, r.schedule, r.amount_cents AS "amountCents", r.first_due_date::text AS "firstDueDate",
              r.created_at AS "createdAt", u.email AS "createdByEmail"
       FROM driver_recurring_charges r LEFT JOIN users u ON u.id = r.created_by_id
       WHERE r.driver_id = $1
       ORDER BY r.first_due_date DESC, r.created_at DESC`,
      [driverId],
    )) as ChargeRow[];

    const today = chicagoDate(now);
    // Newest first: the first row that has already started is the one in force; the rows before it are still waiting.
    const currentIndex = rows.findIndex((row) => row.firstDueDate <= today);
    const changes = rows.map((row, index): RecurringChargeDto => {
      let status: RecurringChargeStatus = "past";
      if (row.firstDueDate > today) status = "pending";
      else if (index === currentIndex) status = "current";
      return { ...row, status };
    });
    const nextPending = [...changes]
      .reverse()
      .find((change) => change.status === "pending");
    return {
      charge:
        changes.find((change) => change.status === "current") ??
        nextPending ??
        null,
      changes,
    };
  }

  /**
   * "Rent from a date" (D101): sets the first rent of a driver with no contract, or changes the rent of any driver. The driver
   * row is locked first (the same lock the rent job and the other driver changes take), then in one transaction: the first due
   * day is worked out from the day picked, today and the last rent already posted; rows that have not started yet are replaced
   * (deleted, kept in the audit line); a row on the very same first day whose rent was never posted (a driver still in
   * onboarding) is updated in place; the audit line records old and new. When the driver is active the first rent is posted at
   * once (the job's own per-driver method, idempotent); a driver still in onboarding is billed only from the day they become
   * active (`rent_from`). `now` is only a parameter so a test can pick the clock.
   * @throws NotFoundException unknown driver.
   * @throws ConflictException the driver is archived.
   */
  async setRent(
    driverId: string,
    dto: CreateRecurringChargeDto,
    adminId: string,
    now: Date = new Date(),
  ): Promise<RecurringChargeDto> {
    const today = chicagoDate(now);

    const saved = await this.db.transaction(async (manager) => {
      const driver = await manager.findOne(Driver, {
        where: { id: driverId },
        lock: { mode: "pessimistic_write" },
      });
      if (!driver) throw new NotFoundException("Driver not found.");
      if (driver.archivedAt !== null) {
        throw new ConflictException(
          "This driver is archived. Unarchive the driver first.",
        );
      }

      const [{ last }] = (await manager.query(
        `SELECT max(effective_date)::text AS last FROM ledger_entries WHERE driver_id = $1 AND kind = 'rent'`,
        [driverId],
      )) as [{ last: string | null }];
      const firstDueDate = firstRentDate(
        dto.schedule,
        dto.startDate,
        billableFromDay(today, last),
      );

      // Rents that have not started cannot have billed anything yet: they are replaced by this one.
      // (Read first, then deleted by id: TypeORM hands back a DELETE ... RETURNING result in a different shape from a SELECT.)
      const replaced = (await manager.query(
        `SELECT schedule, amount_cents AS "amountCents", first_due_date::text AS "firstDueDate"
         FROM driver_recurring_charges WHERE driver_id = $1 AND first_due_date > $2`,
        [driverId, today],
      )) as RentFacts[];
      await manager.query(
        `DELETE FROM driver_recurring_charges WHERE driver_id = $1 AND first_due_date > $2`,
        [driverId, today],
      );
      // A rent that already started on the same first day without posting (the driver is still in onboarding) is updated.
      const [sameDay] = (await manager.query(
        `SELECT schedule, amount_cents AS "amountCents", first_due_date::text AS "firstDueDate"
         FROM driver_recurring_charges WHERE driver_id = $1 AND first_due_date = $2`,
        [driverId, firstDueDate],
      )) as RentFacts[];

      const [saved] = (await manager.query(
        `INSERT INTO driver_recurring_charges (driver_id, schedule, amount_cents, first_due_date, created_by_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (driver_id, first_due_date) DO UPDATE
           SET schedule = EXCLUDED.schedule, amount_cents = EXCLUDED.amount_cents,
               created_by_id = EXCLUDED.created_by_id, created_at = now()
         RETURNING id, created_at AS "createdAt"`,
        [driverId, dto.schedule, dto.amountCents, firstDueDate, adminId],
      )) as [{ id: string; createdAt: Date }];
      const [admin] = (await manager.query(
        `SELECT email FROM users WHERE id = $1`,
        [adminId],
      )) as { email: string }[];

      const before = [...replaced, ...(sameDay ? [sameDay] : [])].map(forAudit);
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "recurring_charge.set",
          entityType: "driver",
          entityId: driverId,
          before: before.length > 0 ? { replaced: before } : null,
          after: {
            schedule: dto.schedule,
            amountCents: dto.amountCents,
            from: dto.startDate,
            firstDueDate,
          },
        },
      ]);
      // Built from what was just saved, not read back: another admin may replace this rent a moment later.
      const status: RecurringChargeStatus =
        firstDueDate > today ? "pending" : "current";
      return {
        id: saved.id,
        schedule: dto.schedule,
        amountCents: dto.amountCents,
        firstDueDate,
        status,
        createdAt: saved.createdAt,
        createdByEmail: admin?.email ?? null,
      } satisfies RecurringChargeDto;
    });
    this.logger.log(`Admin ${adminId} set the rent of driver ${driverId}.`);

    // The first rent now, not at the next hourly run. The rent is already saved, so a failure here is logged (with the driver
    // id) and left to the hourly job, which retries; it must not turn a saved rent into an error for the admin.
    try {
      await this.rentJob.billDriver(driverId, today);
    } catch (error) {
      this.logger.error(
        `Rent for driver ${driverId} could not be posted right after the rent was set: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return saved;
  }

  /**
   * Removes a rent that has not started yet. One that has started has billed (or may have), so it is never removed: change
   * the rent instead.
   * @throws NotFoundException unknown driver, or no such rent on this driver.
   * @throws ConflictException the rent has already started.
   */
  async remove(
    driverId: string,
    chargeId: string,
    adminId: string,
    now: Date = new Date(),
  ): Promise<void> {
    const today = chicagoDate(now);
    await this.db.transaction(async (manager) => {
      const driver = await manager.findOne(Driver, {
        where: { id: driverId },
        lock: { mode: "pessimistic_write" },
      });
      if (!driver) throw new NotFoundException("Driver not found.");
      const row = await this.findOwnRow(manager, driverId, chargeId);
      if (row.firstDueDate <= today) {
        throw new ConflictException(
          "This rent has already started, so it cannot be removed. Change the rent instead.",
        );
      }
      await manager.query(
        `DELETE FROM driver_recurring_charges WHERE id = $1`,
        [chargeId],
      );
      await recordAudit(manager, [
        {
          actorId: adminId,
          action: "recurring_charge.remove",
          entityType: "driver",
          entityId: driverId,
          before: forAudit(row),
        },
      ]);
    });
    this.logger.log(
      `Admin ${adminId} removed a pending rent of driver ${driverId}.`,
    );
  }

  private async findOwnRow(
    manager: EntityManager,
    driverId: string,
    chargeId: string,
  ): Promise<RentFacts> {
    const [row] = (await manager.query(
      `SELECT id, schedule, amount_cents AS "amountCents", first_due_date::text AS "firstDueDate"
       FROM driver_recurring_charges WHERE id = $1 AND driver_id = $2`,
      [chargeId, driverId],
    )) as RentFacts[];
    if (!row) throw new NotFoundException("Rent not found.");
    return row;
  }
}
