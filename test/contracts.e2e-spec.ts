import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { ContractCompany } from "../src/contracts/contract-company.entity.js";
import { Contract } from "../src/contracts/contract.entity.js";
import { ContractsService } from "../src/contracts/contracts.service.js";
import {
  ContractInputDto,
  type ContractDto,
} from "../src/contracts/dto/contract.dto.js";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { ListDriversQueryDto } from "../src/drivers/dto/list-drivers-query.dto.js";
import { Payment } from "../src/payments/payment.entity.js";
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

describe("Contract drafts (Module 2 steps 1 and 2, D71, test database)", () => {
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
      db.getRepository(ContractCompany),
      db,
      null,
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
    expect(await contracts.getCurrent(driverId)).toBeNull();
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
    expect(await contracts.getCurrent(driverId)).toEqual(created);

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
    expect(await contracts.getCurrent(driverId)).toBeNull();
    await expect(
      contracts.createDraft(driverId, body(), admin),
    ).resolves.toBeDefined();
  });

  it("says not found for an unknown driver, an unknown draft and a contract that is not a draft", async () => {
    const unknown = randomUUID();
    await expect(contracts.getCurrent(unknown)).rejects.toThrow(
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
    const read = (await contracts.getCurrent(driverId)) as ContractDto;
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

  describe("details (step 2)", () => {
    /** Every detail filled in, with made-up values only. */
    const details = (companyId: string) => ({
      companyId,
      vehicleModel: "Toyota Camry 2023",
      vehicleVin: "1HGCM82633A004352",
      vehiclePlate: "AB 12345",
      vehiclePlateState: "IL",
      purchaseOptionCents: 2_500_000,
      lesseeAddress: "1 Example St, Chicago IL 60601",
      licenseNumber: "X123-4567-8901",
      licenseState: "IL",
      dateOfBirth: "1990-05-17",
    });

    const firstCompany = async () => (await contracts.listCompanies())[0];

    it("lists the five companies, each name with its own address, ordered by name", async () => {
      const list = await contracts.listCompanies();
      expect(list.map(({ name, address }) => [name, address])).toEqual([
        ["Ashwood Holdings LLC", "114 E Everett St Ste 176, Dixon IL 61021"],
        ["Evergreen Holdings LLC", "114 E Everett St, Ste 130, Dixon IL 61021"],
        ["Gonzo Enterprises Inc", "1107 S State St, Unit 11, Ukiah, CA 95482"],
        [
          "Gonzo Enterprises Inc",
          "2515 Waukegan Rd, Suite 340, Bannockburn IL 60015",
        ],
        ["Silver Pine Holdings LLC", "3902 W North Ave, Chicago IL 60647"],
      ]);
      expect(Object.keys(list[0]).sort()).toEqual(["address", "id", "name"]);
    });

    it("has every detail empty on a draft saved without them (step 1 bodies still work)", async () => {
      const created = await contracts.createDraft(driverId, body(), admin);
      expect(created).toMatchObject({
        companyId: null,
        vehicleModel: null,
        vehicleVin: null,
        vehiclePlate: null,
        vehiclePlateState: null,
        purchaseOptionCents: null,
        lesseeAddress: null,
        licenseNumber: null,
        licenseState: null,
        dateOfBirth: null,
      });
    });

    it("saves every detail and returns the same values when read again", async () => {
      const company = await firstCompany();
      const saved = await contracts.createDraft(
        driverId,
        body(details(company.id)),
        admin,
      );
      const read = (await contracts.getCurrent(driverId)) as ContractDto;
      for (const draft of [saved, read]) {
        expect(draft).toMatchObject(details(company.id));
        expect(typeof draft.purchaseOptionCents).toBe("number");
        expect(draft.dateOfBirth).toBe("1990-05-17");
      }
    });

    it("clears a detail that an update leaves out or sends as null", async () => {
      const company = await firstCompany();
      const saved = await contracts.createDraft(
        driverId,
        body(details(company.id)),
        admin,
      );
      const updated = await contracts.updateDraft(
        saved.id,
        body({ vehicleModel: "Honda Accord", licenseNumber: null }),
        admin,
      );
      expect(updated).toMatchObject({
        vehicleModel: "Honda Accord",
        companyId: null,
        vehicleVin: null,
        licenseNumber: null,
        purchaseOptionCents: null,
        dateOfBirth: null,
      });
    });

    it("refuses a company that is not in the list, on create and on update", async () => {
      const unknown = randomUUID();
      await expect(
        contracts.createDraft(driverId, body({ companyId: unknown }), admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await db.getRepository(Contract).count()).toBe(0);

      const saved = await contracts.createDraft(driverId, body(), admin);
      await expect(
        contracts.updateDraft(saved.id, body({ companyId: unknown }), admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("stores an empty or blank box as nothing and trims the rest", () => {
      const dto = plainToInstance(
        ContractInputDto,
        Object.assign({}, body(), {
          vehicleModel: "   ",
          vehiclePlate: "  AB 12345  ",
          lesseeAddress: "",
        }),
      );
      expect(validateSync(dto)).toEqual([]);
      expect(dto.vehicleModel).toBeNull();
      expect(dto.vehiclePlate).toBe("AB 12345");
      expect(dto.lesseeAddress).toBeNull();
    });

    it("accepts a free-text detail as typed, with no format rule", () => {
      expect(
        problems({
          vehicleVin: "not a real vin",
          vehiclePlateState: "Illinois",
          licenseState: "anything",
          vehiclePlate: "abc",
        }),
      ).toEqual([]);
    });

    it.each([
      ["a purchase option below 0", { purchaseOptionCents: -1 }],
      ["a purchase option with a fraction", { purchaseOptionCents: 100.5 }],
      ["a purchase option typed as text", { purchaseOptionCents: "25000" }],
      [
        "a purchase option too big for the column",
        { purchaseOptionCents: 2_147_483_648 },
      ],
      ["a date of birth that does not exist", { dateOfBirth: "2000-02-30" }],
      ["a date of birth not written YYYY-MM-DD", { dateOfBirth: "05/17/1990" }],
      ["a company id that is not an id", { companyId: "Evergreen" }],
      ["a model over 100 characters", { vehicleModel: "x".repeat(101) }],
      ["a VIN over 50 characters", { vehicleVin: "x".repeat(51) }],
      ["a plate over 20 characters", { vehiclePlate: "x".repeat(21) }],
      ["an address over 300 characters", { lesseeAddress: "x".repeat(301) }],
      [
        "a licence number over 50 characters",
        { licenseNumber: "x".repeat(51) },
      ],
      ["a detail that is not text", { vehicleModel: 12 }],
    ])("refuses %s", (_name, over) => {
      expect(problems(over).length).toBeGreaterThan(0);
    });

    it("accepts the edges: a purchase option of $0 and the largest the column holds", () => {
      expect(problems({ purchaseOptionCents: 0 })).toEqual([]);
      expect(problems({ purchaseOptionCents: 2_147_483_647 })).toEqual([]);
    });

    it("keeps the licence number and date of birth out of the drivers list and the driver page", async () => {
      const company = await firstCompany();
      await contracts.createDraft(driverId, body(details(company.id)), admin);
      const drivers = new DriversService(
        db.getRepository(Driver),
        db.getRepository(PaymentAlias),
        db.getRepository(Payment),
      );
      const list = await drivers.list(plainToInstance(ListDriversQueryDto, {}));
      const page = await drivers.findOne(driverId);
      for (const response of [list, page]) {
        const json = JSON.stringify(response);
        expect(json).not.toContain("X123-4567-8901");
        expect(json).not.toContain("1990-05-17");
        expect(json).not.toMatch(/license|dateOfBirth/i);
      }
    });

    it("keeps a company that contracts point to (it cannot be deleted)", async () => {
      const company = await firstCompany();
      await contracts.createDraft(driverId, body(details(company.id)), admin);
      await expect(
        db.query(`DELETE FROM contract_companies WHERE id = $1`, [company.id]),
      ).rejects.toThrow(/violates foreign key/);
    });
  });
});
