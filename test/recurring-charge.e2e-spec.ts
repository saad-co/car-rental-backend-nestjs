import "reflect-metadata";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { ContractRentJob } from "../src/contracts/contract-rent.job.js";
import { ContractSchedule } from "../src/contracts/contract.entity.js";
import { DailyOperationsService } from "../src/dashboard/daily-ops.service.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { CreateRecurringChargeDto } from "../src/recurring-charges/dto/recurring-charge.dto.js";
import { RecurringChargesService } from "../src/recurring-charges/recurring-charges.service.js";
import { openTestDatabase } from "./test-database.js";

/**
 * The daily or weekly rent set by hand for a driver with no signed contract (D100), worked out by hand. The clock is a
 * Chicago noon (CST, UTC-6, after the clocks went back on 2026-11-01): Sunday 2026-11-15 unless a test says otherwise.
 * 2026-11-02, 11-09, 11-16, 11-23 and 11-30 are Mondays.
 */
const noonOf = (day: string): Date => new Date(`${day}T18:00:00Z`);
const SUNDAY = noonOf("2026-11-15");

interface RentRow {
  day: string;
  cents: number;
  key: string;
  description: string;
}

/** Builds a validated DTO the way the ValidationPipe does and returns the error messages (empty = valid). */
function problems(values: object): string[] {
  const instance = plainToInstance(CreateRecurringChargeDto, values);
  return validateSync(instance).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );
}

describe("A charge set by hand (D100, test database)", () => {
  let db: DataSource;
  let rentJob: ContractRentJob;
  let service: RecurringChargesService;
  let dailyOps: DailyOperationsService;
  let adminId: string;
  let driverId: string;
  let seq = 0;

  beforeAll(async () => {
    db = await openTestDatabase();
    rentJob = new ContractRentJob(db, new LedgerService(db));
    service = new RecurringChargesService(db, rentJob);
    dailyOps = new DailyOperationsService(db);
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE audit_logs, driver_recurring_charges, ledger_entries, contracts, applications, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    driverId = await newDriver({ active: true, rentFrom: "2026-10-01" });
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** A driver: `active` (the three steps done, as the database requires) with billing from `rentFrom`, or onboarding. */
  async function newDriver(options: {
    active: boolean;
    rentFrom?: string | null;
    archived?: boolean;
  }): Promise<string> {
    seq += 1;
    const [{ id }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone) VALUES ('Pat', 'Driver', $1, $2) RETURNING id`,
      [`pat${seq}@test.dev`, `+1312555${String(1000 + seq)}`],
    )) as [{ id: string }];
    if (options.active) await makeActive(id, options.rentFrom ?? null);
    if (options.archived) {
      await db.query(`UPDATE drivers SET archived_at = now() WHERE id = $1`, [
        id,
      ]);
    }
    return id;
  }

  const makeActive = (id: string, rentFrom: string | null) =>
    db.query(
      `UPDATE drivers SET status = 'active', contract_signed_at = now(), deposit_paid_at = now(),
         vehicle_assigned_at = now(), rent_from = $2 WHERE id = $1`,
      [id, rentFrom],
    );

  const rent = async (id = driverId): Promise<RentRow[]> =>
    (await db.query(
      `SELECT effective_date::text AS day, amount_cents AS cents, idempotency_key AS key, description
       FROM ledger_entries WHERE driver_id = $1 AND kind = 'rent' ORDER BY effective_date`,
      [id],
    )) as RentRow[];

  const days = async (id = driverId): Promise<string[]> =>
    (await rent(id)).map((row) => row.day);

  const chargeRows = async (id = driverId) =>
    (await db.query(
      `SELECT schedule, amount_cents AS "amountCents", first_due_date::text AS "firstDueDate"
       FROM driver_recurring_charges WHERE driver_id = $1`,
      [id],
    )) as { schedule: string; amountCents: number; firstDueDate: string }[];

  /** A signed contract written straight into the table (only what billing reads). */
  const signContract = (
    start: string,
    schedule: ContractSchedule,
    cents: number,
    id = driverId,
  ) =>
    db.query(
      `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date, status, sent_at, firma_signing_request_id,
                              sent_values, signed_at, security_deposit_cents)
       VALUES ($1, $2, $3, $4, 'signed', now(), 'firma-test', '{}'::jsonb, now(), 20000)`,
      [id, schedule, cents, start],
    );

  const weekly = (startDate: string, amountCents = 30_000) => ({
    schedule: ContractSchedule.weekly,
    amountCents,
    startDate,
  });
  const daily = (startDate: string, amountCents = 5_000) => ({
    schedule: ContractSchedule.daily,
    amountCents,
    startDate,
  });

  describe("weekly: no back-charging, the start date only fixes the weekday", () => {
    it("a past Monday saved on Sunday 11-15: first rent is Monday 11-16, nothing is posted yet", async () => {
      const charge = await service.setRent(
        driverId,
        weekly("2026-11-02"),
        adminId,
        SUNDAY,
      );
      expect(charge).toMatchObject({
        schedule: "weekly",
        amountCents: 30_000,
        firstDueDate: "2026-11-16",
      });
      expect(await rent()).toEqual([]);
    });

    it("then bills each Monday at $300.00 and nothing before the first rent", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      await rentJob.run(noonOf("2026-11-16"));
      expect(await rent()).toEqual([
        {
          day: "2026-11-16",
          cents: 30_000,
          key: `rent:${driverId}:2026-11-16`,
          description: "Weekly rent, due November 16, 2026",
        },
      ]);
      await rentJob.run(noonOf("2026-11-30"));
      expect(await days()).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
      const [{ balance }] = (await db.query(
        `SELECT sum(CASE direction WHEN 'credit' THEN amount_cents ELSE -amount_cents END)::int AS balance
         FROM ledger_entries WHERE driver_id = $1`,
        [driverId],
      )) as [{ balance: number }];
      expect(balance).toBe(-90_000);
    });

    it("saved on its own weekday, the first rent is today and is posted at once", async () => {
      // Sunday start saved on Sunday 11-15.
      await service.setRent(driverId, weekly("2026-11-01"), adminId, SUNDAY);
      expect(await days()).toEqual(["2026-11-15"]);
    });

    it("a future start date is the first rent and waits for it", async () => {
      const charge = await service.setRent(
        driverId,
        weekly("2026-11-25"),
        adminId,
        SUNDAY,
      );
      expect(charge.firstDueDate).toBe("2026-11-25");
      expect(await rent()).toEqual([]);
      await rentJob.run(noonOf("2026-11-25"));
      expect(await days()).toEqual(["2026-11-25"]);
    });
  });

  describe("daily", () => {
    it("starts today whatever the past start date, posted at once, and never before", async () => {
      const charge = await service.setRent(
        driverId,
        daily("2026-10-01"),
        adminId,
        SUNDAY,
      );
      expect(charge.firstDueDate).toBe("2026-11-15");
      expect(await rent()).toEqual([
        {
          day: "2026-11-15",
          cents: 5_000,
          key: `rent:${driverId}:2026-11-15`,
          description: "Daily rent, November 15, 2026",
        },
      ]);
      await rentJob.run(noonOf("2026-11-17"));
      expect(await days()).toEqual(["2026-11-15", "2026-11-16", "2026-11-17"]);
    });
  });

  describe("who is billed", () => {
    it("a driver still in onboarding keeps the charge but is billed only from the day they become active", async () => {
      const onboarding = await newDriver({ active: false });
      await service.setRent(onboarding, weekly("2026-11-02"), adminId, SUNDAY);
      await rentJob.run(noonOf("2026-11-30"));
      expect(await rent(onboarding)).toEqual([]);
      // Active from Tuesday 11-17: the Monday 11-16 rent is before it and is never billed.
      await makeActive(onboarding, "2026-11-17");
      await rentJob.run(noonOf("2026-11-30"));
      expect(await days(onboarding)).toEqual(["2026-11-23", "2026-11-30"]);
    });

    it("an archived driver is refused and nothing is saved", async () => {
      const archived = await newDriver({
        active: true,
        rentFrom: "2026-10-01",
        archived: true,
      });
      await expect(
        service.setRent(archived, weekly("2026-11-02"), adminId, SUNDAY),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await chargeRows(archived)).toEqual([]);
    });

    it("a driver who becomes inactive stops being billed", async () => {
      await service.setRent(driverId, daily("2026-11-15"), adminId, SUNDAY);
      await db.query(
        `UPDATE drivers SET status = 'inactive', left_reason = 'contract_ended', left_at = now() WHERE id = $1`,
        [driverId],
      );
      await rentJob.run(noonOf("2026-11-20"));
      expect(await days()).toEqual(["2026-11-15"]);
    });
  });

  describe("refusals", () => {
    it("404 for an unknown driver", async () => {
      await expect(
        service.setRent(
          "00000000-0000-4000-8000-000000000000",
          weekly("2026-11-02"),
          adminId,
          SUNDAY,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.get("00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("two admins saving at the same instant: both succeed, one after the other, and one rent is left (the later replaces the earlier)", async () => {
      const results = await Promise.allSettled([
        service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY),
        service.setRent(
          driverId,
          weekly("2026-11-02", 45_000),
          adminId,
          SUNDAY,
        ),
      ]);
      expect(
        results.map((r) =>
          r.status === "rejected" ? String(r.reason) : r.status,
        ),
      ).toEqual(["fulfilled", "fulfilled"]);
      expect(await chargeRows()).toHaveLength(1);
    });
  });

  describe("each due date is written once", () => {
    it("two runs at once, then a run again: every date once", async () => {
      await service.setRent(driverId, daily("2026-11-15"), adminId, SUNDAY);
      await Promise.all([
        rentJob.run(noonOf("2026-11-18")),
        rentJob.run(noonOf("2026-11-18")),
        rentJob.billDriver(driverId, "2026-11-18"),
      ]);
      await rentJob.run(noonOf("2026-11-18"));
      expect(await days()).toEqual([
        "2026-11-15",
        "2026-11-16",
        "2026-11-17",
        "2026-11-18",
      ]);
    });
  });

  describe("a signed contract later takes over", () => {
    it("the charge bills until the day before the contract's start date; the contract's first rent is its own", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      // Signed Monday 2026-12-07, weekly $400.00: its first rent (12-07) is posted at signing, not by the job.
      await signContract("2026-12-07", ContractSchedule.weekly, 40_000);
      await rentJob.run(noonOf("2026-12-14"));
      expect(await rent()).toMatchObject([
        { day: "2026-11-16", cents: 30_000 },
        { day: "2026-11-23", cents: 30_000 },
        { day: "2026-11-30", cents: 30_000 },
        { day: "2026-12-14", cents: 40_000 },
      ]);
    });
  });

  describe("the billable_contracts view", () => {
    it("lists a signed contract as it was read before, and leaves drafts out", async () => {
      await signContract("2026-11-10", ContractSchedule.weekly, 40_900);
      await db.query(
        `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date) VALUES ($1, 'daily', 6100, '2026-11-12')`,
        [driverId],
      );
      const rows = (await db.query(
        `SELECT schedule, total_rate_cents, start_date::text AS start_date, security_deposit_cents, bills_start_date
         FROM billable_contracts WHERE driver_id = $1`,
        [driverId],
      )) as Record<string, unknown>[];
      expect(rows).toEqual([
        {
          schedule: "weekly",
          total_rate_cents: 40_900,
          start_date: "2026-11-10",
          security_deposit_cents: 20_000,
          bills_start_date: false,
        },
      ]);
    });

    it("lists the charge with no deposit and no vehicle, and says its first rent is posted by the job", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      const rows = (await db.query(
        `SELECT schedule, total_rate_cents, start_date::text AS start_date, security_deposit_cents, vehicle_model,
                vehicle_plate, bills_start_date
         FROM billable_contracts WHERE driver_id = $1`,
        [driverId],
      )) as Record<string, unknown>[];
      expect(rows).toEqual([
        {
          schedule: "weekly",
          total_rate_cents: 30_000,
          start_date: "2026-11-16",
          security_deposit_cents: 0,
          vehicle_model: null,
          vehicle_plate: null,
          bills_start_date: true,
        },
      ]);
    });
  });

  describe("the screens read it", () => {
    it("daily operations: the driver is due on the charge's due day, weekly, at its rate", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      const monday = noonOf("2026-11-16");
      await rentJob.run(monday);
      const { dueToday } = await dailyOps.get(monday);
      expect(dueToday).toMatchObject([
        {
          driverId,
          schedule: "weekly",
          rateCents: 30_000,
          amountDueCents: 30_000,
          openCents: 30_000,
          status: "not_yet_paid",
        },
      ]);
      // Not due the day before.
      expect((await dailyOps.get(SUNDAY)).dueToday).toEqual([]);
    });

    it("the reminders' figures carry the charge as the contract in force", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      const [figures] = await dailyOps.driverFigures(noonOf("2026-11-16"), [
        driverId,
      ]);
      expect(figures.contract).toMatchObject({
        schedule: "weekly",
        totalRateCents: 30_000,
        startDate: "2026-11-16",
        billsStartDate: true,
        securityDepositCents: 0,
      });
      // Before its first due day no contract is in force yet.
      const [before] = await dailyOps.driverFigures(SUNDAY, [driverId]);
      expect(before.contract).toBeNull();
    });
  });

  describe("reading and recording", () => {
    it("GET gives nothing, then the saved rent with its status", async () => {
      expect(await service.get(driverId, SUNDAY)).toEqual({
        charge: null,
        changes: [],
      });
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      const { charge, changes } = await service.get(driverId, SUNDAY);
      expect(charge).toMatchObject({
        schedule: "weekly",
        amountCents: 30_000,
        firstDueDate: "2026-11-16",
        status: "pending",
        createdByEmail: "admin@test.dev",
      });
      expect(changes).toHaveLength(1);
      // From its first due day it is the rent in force.
      const monday = await service.get(driverId, noonOf("2026-11-16"));
      expect(monday.charge).toMatchObject({ status: "current" });
    });

    it("writes one audit line with who set what", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      const lines = (await db.query(
        `SELECT action, entity_type, entity_id, actor_id, before, after FROM audit_logs`,
      )) as {
        action: string;
        entity_type: string;
        entity_id: string;
        actor_id: string;
        before: unknown;
        after: Record<string, unknown>;
      }[];
      expect(lines).toEqual([
        {
          action: "recurring_charge.set",
          entity_type: "driver",
          entity_id: driverId,
          actor_id: adminId,
          before: null,
          after: {
            schedule: "weekly",
            amountCents: 30_000,
            from: "2026-11-02",
            firstDueDate: "2026-11-16",
          },
        },
      ]);
    });

    it("a refused save leaves no audit line and no rent", async () => {
      const archived = await newDriver({
        active: true,
        rentFrom: "2026-10-01",
        archived: true,
      });
      await expect(
        service.setRent(archived, weekly("2026-11-02"), adminId, SUNDAY),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await db.query(`SELECT 1 FROM audit_logs`)).toEqual([]);
      expect(await chargeRows(archived)).toEqual([]);
    });
  });

  // Changing the rent (D101): "rent from a date". Sunday 2026-11-15 unless a test moves the clock; Mondays are 11-16, 11-23,
  // 11-30 and 12-07; the Thursday is 12-03.
  describe("changing the rent (D101)", () => {
    const setAt = (
      day: string,
      input: ReturnType<typeof weekly>,
      id = driverId,
    ) => service.setRent(id, input, adminId, noonOf(day));
    const amountsByDay = async (id = driverId) =>
      (await rent(id)).map((row) => [row.day, row.cents]);
    const contractRow = async () =>
      (await db.query(
        `SELECT status, total_rate_cents, schedule, start_date::text AS start_date FROM contracts WHERE driver_id = $1`,
        [driverId],
      )) as unknown[];

    it("a started charge changed from a later Monday: the old rent bills to the day before, the new one from the date, nothing twice", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      await rentJob.run(noonOf("2026-11-16"));
      expect(await amountsByDay()).toEqual([["2026-11-16", 30_000]]);

      const changed = await setAt("2026-11-16", weekly("2026-11-30", 35_000));
      expect(changed).toMatchObject({
        firstDueDate: "2026-11-30",
        amountCents: 35_000,
        status: "pending",
      });
      // The rent already posted stays and nothing is added until the new rent starts.
      expect(await amountsByDay()).toEqual([["2026-11-16", 30_000]]);
      const listed = await service.get(driverId, noonOf("2026-11-16"));
      expect(listed.changes).toMatchObject([
        { status: "pending" },
        { status: "current" },
      ]);

      await rentJob.run(noonOf("2026-12-07"));
      // 300 + 300 (11-16, 11-23), then 350 + 350 (11-30, 12-07).
      expect(await amountsByDay()).toEqual([
        ["2026-11-16", 30_000],
        ["2026-11-23", 30_000],
        ["2026-11-30", 35_000],
        ["2026-12-07", 35_000],
      ]);
    });

    it("never starts on a day whose rent is already posted: daily saved today, changed today, starts tomorrow", async () => {
      await service.setRent(driverId, daily("2026-11-15"), adminId, SUNDAY);
      expect(await amountsByDay()).toEqual([["2026-11-15", 5_000]]);
      const changed = await service.setRent(
        driverId,
        daily("2026-11-15", 6_000),
        adminId,
        SUNDAY,
      );
      expect(changed.firstDueDate).toBe("2026-11-16");
      await rentJob.run(noonOf("2026-11-17"));
      expect(await amountsByDay()).toEqual([
        ["2026-11-15", 5_000],
        ["2026-11-16", 6_000],
        ["2026-11-17", 6_000],
      ]);
    });

    it("the due weekday can move: Monday rent becomes Thursday rent from 12-03, Monday 12-07 is not billed", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      await rentJob.run(noonOf("2026-11-30"));
      await setAt("2026-11-30", weekly("2026-12-03"));
      await rentJob.run(noonOf("2026-12-10"));
      expect(await days()).toEqual([
        "2026-11-16",
        "2026-11-23",
        "2026-11-30",
        "2026-12-03",
        "2026-12-10",
      ]);
    });

    it("rent from a signed firma contract can be changed from a date; the contract itself is untouched", async () => {
      // Weekly $400.00 from Monday 11-02; its first rent (11-02) is posted at signing, the job bills 11-09 on.
      await signContract("2026-11-02", ContractSchedule.weekly, 40_000);
      await rentJob.run(noonOf("2026-11-16"));
      expect(await amountsByDay()).toEqual([
        ["2026-11-09", 40_000],
        ["2026-11-16", 40_000],
      ]);
      const contractBefore = await contractRow();

      const changed = await setAt("2026-11-16", weekly("2026-11-30", 45_000));
      expect(changed).toMatchObject({
        firstDueDate: "2026-11-30",
        amountCents: 45_000,
      });
      await rentJob.run(noonOf("2026-11-30"));
      // The contract bills 11-23 (the day before the change starts), then the change bills 11-30.
      expect(await amountsByDay()).toEqual([
        ["2026-11-09", 40_000],
        ["2026-11-16", 40_000],
        ["2026-11-23", 40_000],
        ["2026-11-30", 45_000],
      ]);
      expect(await contractRow()).toEqual(contractBefore);
    });

    it("a change that has not started is replaced, and the audit line keeps what it replaced", async () => {
      await service.setRent(driverId, weekly("2026-11-25"), adminId, SUNDAY);
      await service.setRent(
        driverId,
        weekly("2026-11-27", 32_000),
        adminId,
        SUNDAY,
      );
      expect(await chargeRows()).toEqual([
        { schedule: "weekly", amountCents: 32_000, firstDueDate: "2026-11-27" },
      ]);
      const lines = (await db.query(
        `SELECT before FROM audit_logs WHERE before IS NOT NULL`,
      )) as { before: unknown }[];
      expect(lines.map((l) => l.before)).toEqual([
        {
          replaced: [
            {
              schedule: "weekly",
              amountCents: 30_000,
              firstDueDate: "2026-11-25",
            },
          ],
        },
      ]);
    });

    it("a started rent with nothing posted yet (driver in onboarding) that lands on the same first day is updated in place", async () => {
      const onboarding = await newDriver({ active: false });
      await service.setRent(onboarding, weekly("2026-11-02"), adminId, SUNDAY);
      // Monday 11-16: the rent has started but the driver is not active, so nothing was posted.
      await setAt("2026-11-16", weekly("2026-11-02", 35_000), onboarding);
      expect(await chargeRows(onboarding)).toEqual([
        { schedule: "weekly", amountCents: 35_000, firstDueDate: "2026-11-16" },
      ]);
    });

    it("a change takes the new amount into the screens: daily operations on the day it starts", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      await rentJob.run(noonOf("2026-11-16"));
      await setAt("2026-11-16", weekly("2026-11-30", 35_000));
      await rentJob.run(noonOf("2026-11-30"));
      const { dueToday } = await dailyOps.get(noonOf("2026-11-30"));
      expect(dueToday).toMatchObject([
        { driverId, rateCents: 35_000, amountDueCents: 35_000 },
      ]);
    });

    it("removes a rent that has not started and refuses one that has", async () => {
      await service.setRent(driverId, weekly("2026-11-02"), adminId, SUNDAY);
      await rentJob.run(noonOf("2026-11-16"));
      const pending = await setAt("2026-11-16", weekly("2026-11-30", 35_000));
      const listed = await service.get(driverId, noonOf("2026-11-16"));
      const started = listed.changes.find((c) => c.status === "current");

      await expect(
        service.remove(driverId, started!.id, adminId, noonOf("2026-11-16")),
      ).rejects.toBeInstanceOf(ConflictException);
      await service.remove(driverId, pending.id, adminId, noonOf("2026-11-16"));
      expect(await chargeRows()).toEqual([
        { schedule: "weekly", amountCents: 30_000, firstDueDate: "2026-11-16" },
      ]);
      const [line] = (await db.query(
        `SELECT before FROM audit_logs WHERE action = 'recurring_charge.remove'`,
      )) as { before: unknown }[];
      expect(line.before).toEqual({
        schedule: "weekly",
        amountCents: 35_000,
        firstDueDate: "2026-11-30",
      });
    });

    it("404 removing a rent that is not this driver's or does not exist", async () => {
      const other = await newDriver({ active: true, rentFrom: "2026-10-01" });
      const theirs = await service.setRent(
        other,
        weekly("2026-11-25"),
        adminId,
        SUNDAY,
      );
      await expect(
        service.remove(driverId, theirs.id, adminId, SUNDAY),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.remove(
          driverId,
          "00000000-0000-4000-8000-000000000000",
          adminId,
          SUNDAY,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await chargeRows(other)).toHaveLength(1);
    });
  });

  describe("the request body", () => {
    it("accepts a weekly or daily charge in whole cents with a real date", () => {
      expect(problems(weekly("2026-11-02"))).toEqual([]);
      expect(problems(daily("2026-11-15", 1))).toEqual([]);
    });

    it("refuses zero, negative, fractional and non-numeric amounts", () => {
      for (const amountCents of [0, -5, 12.5, "300", null]) {
        expect(
          problems({ ...weekly("2026-11-02"), amountCents }).length,
        ).toBeGreaterThan(0);
      }
    });

    it("refuses an unknown schedule and a date that is not a real day", () => {
      expect(
        problems({ ...weekly("2026-11-02"), schedule: "monthly" }).length,
      ).toBeGreaterThan(0);
      for (const startDate of ["2026-02-30", "2026-1-5", "tomorrow", ""]) {
        expect(problems(weekly(startDate)).length).toBeGreaterThan(0);
      }
    });

    it("refuses a missing field", () => {
      expect(problems({ schedule: "weekly" }).length).toBeGreaterThan(0);
      expect(problems({}).length).toBeGreaterThan(0);
    });
  });
});
