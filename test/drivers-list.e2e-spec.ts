import type { DataSource } from "typeorm";
import { AliasType } from "../src/aliases/normalize-alias.js";
import {
  AliasSource,
  PaymentAlias,
} from "../src/aliases/payment-alias.entity.js";
import { Driver, DriverStatus } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

describe("Drivers list with aliases and payment summary (test database)", () => {
  let db: DataSource;
  let service: DriversService;

  beforeAll(async () => {
    db = await openTestDatabase();
    service = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
  });

  beforeEach(async () => {
    await db.query("TRUNCATE payments, payment_aliases, drivers CASCADE");
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("shows each driver's aliases and payment count and last payment, and zeros for a new driver", async () => {
    const [tim, kim] = await db.getRepository(Driver).save([
      {
        firstName: "Tim",
        lastName: "Sutton",
        email: "tim@example.com",
        phone: "+13125550101",
      },
      {
        firstName: "Kim",
        lastName: "Lee",
        email: "kim@example.com",
        phone: "+13125550102",
      },
    ]);
    await db.getRepository(PaymentAlias).insert([
      {
        driverId: tim.id,
        type: AliasType.zelle,
        value: "TIMOTHY SUTTON",
        valueNormalized: "timothy sutton",
        source: AliasSource.legacy,
      },
      {
        driverId: tim.id,
        type: AliasType.cashapp,
        value: "Sutton Logistics",
        valueNormalized: "sutton logistics",
        source: AliasSource.manual,
      },
    ]);
    const base = {
      source: PaymentSource.email_cashapp,
      transactionId: null,
      amountCents: 5800,
      senderName: "Sutton Logistics",
      senderHandle: null,
      extractionConfidence: 0.9,
      status: PaymentStatus.confirmed,
      driverId: tim.id,
      matchMethod: MatchMethod.alias,
    };
    await db.getRepository(Payment).insert([
      {
        ...base,
        externalId: "e1",
        occurredAt: new Date("2026-10-10T12:00:00Z"),
      },
      {
        ...base,
        externalId: "e2",
        occurredAt: new Date("2026-10-11T12:00:00Z"),
      },
    ]);

    const page = await service.list({ page: 1, limit: 20 });
    const timDto = page.items.find((d) => d.id === tim.id);
    const kimDto = page.items.find((d) => d.id === kim.id);

    // Ordered by payment method as declared (Zelle first), then by value.
    // Each alias also carries its id, which the driver page needs to remove it (D69).
    expect(timDto?.aliases).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        type: "zelle",
        value: "TIMOTHY SUTTON",
        source: "legacy",
      },
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        type: "cashapp",
        value: "Sutton Logistics",
        source: "manual",
      },
    ]);
    expect(timDto?.paymentCount).toBe(2);
    expect(timDto?.lastPaymentAt).toEqual(new Date("2026-10-11T12:00:00Z"));
    expect(kimDto).toMatchObject({
      aliases: [],
      paymentCount: 0,
      lastPaymentAt: null,
    });

    expect((await service.findOne(tim.id)).paymentCount).toBe(2);
  });

  describe("search (B75)", () => {
    const names = async (search: string, status?: DriverStatus) =>
      (await service.list({ page: 1, limit: 8, search, status })).items.map(
        (d) => `${d.firstName} ${d.lastName}`,
      );

    beforeEach(async () => {
      await db.getRepository(Driver).save([
        {
          firstName: "Patricia",
          lastName: "Gomez",
          email: "pg@example.com",
          phone: "+13125550101",
        },
        {
          firstName: "Sam",
          lastName: "Patel",
          email: "sam@fleet.test",
          phone: "+17735550199",
          status: DriverStatus.inactive,
        },
      ]);
    });

    it("matches first or last name, the full name, and email, ignoring case", async () => {
      expect((await names("PAT")).sort()).toEqual([
        "Patricia Gomez",
        "Sam Patel",
      ]);
      expect(await names("sam patel")).toEqual(["Sam Patel"]);
      expect(await names("fleet.test")).toEqual(["Sam Patel"]);
    });

    it("matches the phone by its digits, typed in any format", async () => {
      expect(await names("(312) 555-0101")).toEqual(["Patricia Gomez"]);
    });

    it("combines the search with the status filter", async () => {
      expect(await names("pat", DriverStatus.inactive)).toEqual(["Sam Patel"]);
    });
  });
});
