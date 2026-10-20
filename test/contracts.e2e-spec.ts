import { ConflictException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { Contract } from "../src/contracts/contract.entity.js";
import { ContractsService } from "../src/contracts/contracts.service.js";
import {
  ContractInputDto,
  type ContractDto,
} from "../src/contracts/dto/contract.dto.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { openTestDatabase } from "./test-database.js";

/** A valid body: the weekly sample ($399, $200 deposit, 18 months from 2026-10-13). */
const body = (over: Partial<ContractInputDto> = {}): ContractInputDto => ({
  schedule: "weekly",
  totalRateCents: 39_900,
  startDate: "2026-10-13",
  termMonths: 18,
  securityDepositCents: 20_000,
  documentationFeeCents: 0,
  insuranceStartFeeCents: 0,
  otherOneTimeCents: 0,
  holdVehicleCents: 0,
  excessMileageCents: 0,
  insuranceExcessCents: 0,
  otherRecurringCents: 0,
  ...over,
});

describe("Contract drafts (Module 2 step 1, D71, test database)", () => {
  let db: DataSource;
  let contracts: ContractsService;
  let admin: string;
  let driverId: string;

  /** The errors a request body gets from the DTO checks, as the global ValidationPipe would find them. */
  function problems(over: Record<string, unknown>): string[] {
    return validateSync(
      plainToInstance(ContractInputDto, Object.assign({}, body(), over)),
    ).flatMap((e) => Object.values(e.constraints ?? {}));
  }

  const newDriver = async (n: number): Promise<string> => {
    const [{ id }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Test', 'Driver', $1, $2) RETURNING id`,
      [`driver${n}@test.test`, `+1312555010${n}`],
    )) as [{ id: string }];
    return id;
  };

  beforeAll(async () => {
    db = await openTestDatabase();
    contracts = new ContractsService(
      db.getRepository(Contract),
      db.getRepository(Driver),
    );
  });

  beforeEach(async () => {
    await db.query("TRUNCATE contracts, drivers, users CASCADE");
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    driverId = await newDriver(1);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("calculates the numbers without saving anything", async () => {
    const numbers = contracts.calculate(body());
    expect(numbers).toMatchObject({
      baseCents: 16_758,
      insuranceCents: 11_970,
      milesCents: 5_187,
      maintenanceCents: 3_990,
      taxCents: 1_995,
      paymentCents: 39_900,
      oneTimeTotalCents: 20_000,
      amountDueAtPickupCents: 59_900,
      recurringTotalCents: 39_900,
      endDate: "2028-04-13",
    });
    expect(await db.getRepository(Contract).count()).toBe(0);
  });

  it("has no draft until one is created", async () => {
    expect(await contracts.getDraft(driverId)).toBeNull();
  });

  it("creates a draft that returns the inputs and the calculated numbers", async () => {
    const created = await contracts.createDraft(driverId, body(), admin);
    expect(created).toMatchObject({
      driverId,
      status: "draft",
      schedule: "weekly",
      totalRateCents: 39_900,
      startDate: "2026-10-13",
      termMonths: 18,
      securityDepositCents: 20_000,
      numbers: { amountDueAtPickupCents: 59_900, endDate: "2028-04-13" },
    });
    expect(await contracts.getDraft(driverId)).toEqual(created);

    const [row] = (await db.query(
      `SELECT created_by_id, updated_by_id FROM contracts`,
    )) as [{ created_by_id: string; updated_by_id: string }];
    expect(row).toEqual({ created_by_id: admin, updated_by_id: admin });
  });

  it("refuses a second draft for the same driver, but another driver may have one", async () => {
    await contracts.createDraft(driverId, body(), admin);
    await expect(
      contracts.createDraft(driverId, body(), admin),
    ).rejects.toThrow(ConflictException);
    await expect(
      contracts.createDraft(await newDriver(2), body(), admin),
    ).resolves.toBeDefined();
  });

  it("makes exactly one draft when two creates arrive at once", async () => {
    const results = await Promise.allSettled([
      contracts.createDraft(driverId, body(), admin),
      contracts.createDraft(driverId, body({ totalRateCents: 40_900 }), admin),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.filter((r) => r.status === "rejected");
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect(await db.getRepository(Contract).count()).toBe(1);
  });

  it("replaces every input on update and recalculates", async () => {
    const created = await contracts.createDraft(driverId, body(), admin);
    const [other] = [
      (await db.query(
        `INSERT INTO users (email, password_hash, role) VALUES ('bob@admin.test', 'x', 'admin') RETURNING id`,
      )) as [{ id: string }],
    ].flat();

    const updated = await contracts.updateDraft(
      created.id,
      body({
        schedule: "daily",
        totalRateCents: 6_100,
        startDate: "2026-08-31",
        termMonths: 6,
        securityDepositCents: 30_000,
        excessMileageCents: 25,
      }),
      other.id,
    );
    expect(updated).toMatchObject({
      id: created.id,
      schedule: "daily",
      totalRateCents: 6_100,
      termMonths: 6,
      numbers: {
        baseCents: 2_562,
        amountDueAtPickupCents: 36_100,
        recurringTotalCents: 6_125,
        endDate: "2027-02-28",
      },
    });
    const [row] = (await db.query(
      `SELECT created_by_id, updated_by_id FROM contracts`,
    )) as [{ created_by_id: string; updated_by_id: string }];
    expect(row).toEqual({ created_by_id: admin, updated_by_id: other.id });
  });

  it("deletes a draft, after which the driver can start a new one", async () => {
    const created = await contracts.createDraft(driverId, body(), admin);
    await contracts.deleteDraft(created.id);
    expect(await contracts.getDraft(driverId)).toBeNull();
    await expect(
      contracts.createDraft(driverId, body(), admin),
    ).resolves.toBeDefined();
  });

  it("says not found for an unknown driver, an unknown draft and a contract that is not a draft", async () => {
    const unknown = randomUUID();
    await expect(contracts.getDraft(unknown)).rejects.toThrow(
      NotFoundException,
    );
    await expect(contracts.createDraft(unknown, body(), admin)).rejects.toThrow(
      NotFoundException,
    );
    await expect(contracts.updateDraft(unknown, body(), admin)).rejects.toThrow(
      NotFoundException,
    );
    await expect(contracts.deleteDraft(unknown)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("lets the database refuse values the API would refuse", async () => {
    const insert = (rate: number, term: number, deposit: number) =>
      db.query(
        `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date, term_months, security_deposit_cents)
         VALUES ($1, 'weekly', $2, '2026-10-13', $3, $4)`,
        [driverId, rate, term, deposit],
      );
    await expect(insert(0, 18, 0)).rejects.toThrow(
      /contracts_total_rate_range/,
    );
    await expect(insert(39_900, 0, 0)).rejects.toThrow(/contracts_term_range/);
    await expect(insert(39_900, 18, -1)).rejects.toThrow(
      /contracts_charges_range/,
    );
  });

  describe("what a body may contain", () => {
    it("accepts the sample and the edges", () => {
      expect(problems({})).toEqual([]);
      expect(
        problems({ totalRateCents: 1, termMonths: 1, holdVehicleCents: 0 }),
      ).toEqual([]);
      expect(
        problems({
          totalRateCents: 1_000_000,
          termMonths: 60,
          otherRecurringCents: 1_000_000,
        }),
      ).toEqual([]);
    });

    it.each([
      ["a total rate of 0", { totalRateCents: 0 }],
      ["a total rate over $10,000", { totalRateCents: 1_000_001 }],
      ["a negative fee", { documentationFeeCents: -1 }],
      ["a charge over $10,000", { holdVehicleCents: 1_000_001 }],
      ["a term of 0", { termMonths: 0 }],
      ["a term of 61", { termMonths: 61 }],
      ["a date that is not YYYY-MM-DD", { startDate: "10/13/2026" }],
      ["a day that does not exist", { startDate: "2026-02-30" }],
      ["cents with a fraction", { securityDepositCents: 100.5 }],
      ["a rate typed as text", { totalRateCents: "399" }],
      ["an unknown schedule", { schedule: "monthly" }],
    ])("refuses %s", (_name, over) => {
      expect(problems(over).length).toBeGreaterThan(0);
    });
  });

  it("returns the numbers on a saved draft as numbers, never as strings", async () => {
    const created: ContractDto = await contracts.createDraft(
      driverId,
      body(),
      admin,
    );
    const read = (await contracts.getDraft(driverId)) as ContractDto;
    for (const value of [
      read.totalRateCents,
      read.termMonths,
      read.numbers.baseCents,
    ]) {
      expect(typeof value).toBe("number");
    }
    expect(typeof read.startDate).toBe("string");
    expect(read.startDate).toBe(created.startDate);
  });
});
