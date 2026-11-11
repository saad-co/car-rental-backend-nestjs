import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { CollectionsService } from "../src/dashboard/collections.service.js";
import { DailyOperationsService } from "../src/dashboard/daily-ops.service.js";
import type { CollectionsQueryDto } from "../src/dashboard/dto/collections.dto.js";
import type { DayRangeQueryDto } from "../src/dashboard/dto/day-range-query.dto.js";
import { Driver, DriverStatus } from "../src/drivers/driver.entity.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

/**
 * Collections per month, week and day, and revenue per driver (Dashboard page 2, D93), worked out by hand. The clock is
 * Wednesday 2026-11-11, noon in Chicago (CST, UTC-6, since the clocks went back on 2026-11-01 at 2 AM: 18:00 UTC).
 *
 * Confirmed payments (Chicago time, and the UTC instant stored), each the money of one driver:
 *   2026-09-15 12:00 CDT = 17:00Z   Bob   $75   (week of Mon 09-14)
 *   2026-10-31 22:00 CDT = 11-01 03:00Z   Ann   $100  (Saturday; already Nov 1 in UTC: the trap)
 *   2026-11-01 23:30 CST = 11-02 05:30Z   Ann   $50   (Sunday, the last day of week 10-26; Nov 2 in UTC)
 *   2026-11-02 00:30 CST = 06:30Z   Bob   $200  (Monday: week 11-02)
 *   2026-11-09 08:00 CST = 14:00Z   Ann   $300  (Monday: current week)
 *   2026-11-11 11:00 CST = 17:00Z   Cy    $25   (today; Cy is archived)
 * Not collected: an unmatched $999 and a rejected $888, both on 11-09, and an adjustment credit of $500 on Ann's ledger.
 * Total $750 in 6 payments: Ann $450 (3), Bob $275 (2), Cy $25 (1).
 */
const NOW = new Date("2026-11-11T18:00:00Z");

describe("Collections and revenue per driver (D93, test database)", () => {
  let db: DataSource;
  let service: CollectionsService;
  let seq = 0;
  let ann: string;
  let bob: string;
  let cy: string;

  beforeAll(async () => {
    db = await openTestDatabase();
    service = new CollectionsService(db);
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE ledger_entries, payments, payment_aliases, contracts, applications, drivers, users CASCADE",
    );
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function driver(
    name: string,
    overrides: Partial<Driver> = {},
  ): Promise<string> {
    const done = new Date("2026-08-01T12:00:00Z");
    const saved = await db.getRepository(Driver).save({
      firstName: name,
      lastName: "Driver",
      email: `${name.toLowerCase()}@test.dev`,
      phone: "+13125550101",
      status: DriverStatus.active,
      contractSignedAt: done,
      depositPaidAt: done,
      vehicleAssignedAt: done,
      ...overrides,
    });
    return saved.id;
  }

  async function payment(
    cents: number,
    occurredAt: string,
    driverId: string | null,
    status = PaymentStatus.confirmed,
  ) {
    await db.getRepository(Payment).insert({
      source: PaymentSource.email_zelle,
      externalId: `ext-${++seq}`,
      transactionId: null,
      amountCents: cents,
      senderName: "Pat Example",
      senderHandle: null,
      occurredAt: new Date(occurredAt),
      extractionConfidence: null,
      status,
      driverId: status === PaymentStatus.confirmed ? driverId : null,
      matchMethod:
        status === PaymentStatus.confirmed ? MatchMethod.manual : null,
      matchAttemptedAt:
        status === PaymentStatus.confirmed ? null : new Date(occurredAt),
    });
  }

  /** The six collected payments, the two that are not collected, and a manual credit on Ann's ledger. */
  async function seed() {
    ann = await driver("Ann");
    bob = await driver("Bob", { status: DriverStatus.inactive });
    cy = await driver("Cy", { archivedAt: new Date("2026-11-05T12:00:00Z") });
    await payment(7500, "2026-09-15T17:00:00Z", bob);
    await payment(10000, "2026-11-01T03:00:00Z", ann);
    await payment(5000, "2026-11-02T05:30:00Z", ann);
    await payment(20000, "2026-11-02T06:30:00Z", bob);
    await payment(30000, "2026-11-09T14:00:00Z", ann);
    await payment(2500, "2026-11-11T17:00:00Z", cy);
    await payment(99900, "2026-11-09T15:00:00Z", null, PaymentStatus.unmatched);
    await payment(88800, "2026-11-09T16:00:00Z", null, PaymentStatus.rejected);
    const [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    await db.query(
      `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, description, effective_date, idempotency_key, created_by_id)
       VALUES ($1, 'credit', 50000, 'adjustment', 'test', '2026-11-05', 'adj-1', $2)`,
      [ann, admin],
    );
  }

  const query = (
    view: CollectionsQueryDto["view"],
    extra: Partial<CollectionsQueryDto> = {},
  ): CollectionsQueryDto => ({ view, page: 1, limit: 8, ...extra });

  const range = (extra: Partial<DayRangeQueryDto> = {}): DayRangeQueryDto => ({
    page: 1,
    limit: 8,
    ...extra,
  });

  describe("collections", () => {
    it("is empty, in the right shape, with no payments", async () => {
      const result = await service.collections(query("monthly"), NOW);
      expect(result).toEqual({
        view: "monthly",
        items: [],
        total: 0,
        page: 1,
        limit: 8,
        totalCents: 0,
        paymentCount: 0,
      });
    });

    it("monthly: one row per month from the first payment, newest first; unmatched, rejected and credits are not collected", async () => {
      await seed();
      const result = await service.collections(query("monthly"), NOW);
      expect(result.items).toEqual([
        {
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          totalCents: 57500, // 50 + 200 + 300 + 25 (the Oct 31 payment is October)
          paymentCount: 4,
        },
        {
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          totalCents: 10000,
          paymentCount: 1,
        },
        {
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          totalCents: 7500,
          paymentCount: 1,
        },
      ]);
      expect(result).toMatchObject({
        total: 3,
        totalCents: 75000,
        paymentCount: 6,
      });
    });

    it("weekly: Monday to Sunday in Chicago, quiet weeks are 0, and Sunday night belongs to its own week", async () => {
      await seed();
      const result = await service.collections(query("weekly"), NOW);
      expect(result.total).toBe(9);
      expect(
        result.items.map((i) => [i.periodStart, i.totalCents, i.paymentCount]),
      ).toEqual([
        ["2026-11-09", 32500, 2], // 300 + today's 25
        ["2026-11-02", 20000, 1], // Monday 00:30 CST
        ["2026-10-26", 15000, 2], // Sat Oct 31 (100) + Sun Nov 1 23:30 (50): both Chicago days of that week
        ["2026-10-19", 0, 0],
        ["2026-10-12", 0, 0],
        ["2026-10-05", 0, 0],
        ["2026-09-28", 0, 0],
        ["2026-09-21", 0, 0],
      ]);
      expect(result.items[2].periodEnd).toBe("2026-11-01");

      const second = await service.collections(
        query("weekly", { page: 2 }),
        NOW,
      );
      expect(
        second.items.map((i) => [i.periodStart, i.totalCents, i.paymentCount]),
      ).toEqual([["2026-09-14", 7500, 1]]);
    });

    it("weekly agrees with the weekly total on Page 1 (D92)", async () => {
      await seed();
      const pageOne = await new DailyOperationsService(db).get(NOW);
      const weekly = await service.collections(query("weekly"), NOW);
      for (const week of pageOne.weeks.slice(0, 9)) {
        const row = weekly.items
          .concat(
            (await service.collections(query("weekly", { page: 2 }), NOW))
              .items,
          )
          .find((i) => i.periodStart === week.weekStart);
        expect(row?.totalCents).toBe(week.totalCents);
        expect(row?.paymentCount).toBe(week.paymentCount);
      }
    });

    it("daily with a custom range: days are Chicago days, not UTC days", async () => {
      await seed();
      const result = await service.collections(
        query("daily", { from: "2026-10-31", to: "2026-11-02" }),
        NOW,
      );
      expect(
        result.items.map((i) => [i.periodStart, i.totalCents, i.paymentCount]),
      ).toEqual([
        ["2026-11-02", 20000, 1],
        ["2026-11-01", 5000, 1], // 23:30 CST, Nov 2 in UTC
        ["2026-10-31", 10000, 1], // 22:00 CDT, Nov 1 in UTC
      ]);
      expect(result).toMatchObject({
        total: 3,
        totalCents: 35000,
        paymentCount: 3,
      });
    });

    it("a range that cuts a week holds only the days inside it; the total is the range's", async () => {
      await seed();
      const result = await service.collections(
        query("weekly", { from: "2026-11-01", to: "2026-11-09" }),
        NOW,
      );
      expect(
        result.items.map((i) => [i.periodStart, i.totalCents, i.paymentCount]),
      ).toEqual([
        ["2026-11-09", 30000, 1],
        ["2026-11-02", 20000, 1],
        ["2026-10-26", 5000, 1], // Oct 31's $100 is outside the range
      ]);
      expect(result).toMatchObject({ totalCents: 55000, paymentCount: 3 });
    });

    it("a range with no payments still lists its days, all 0", async () => {
      await seed();
      const result = await service.collections(
        query("daily", { from: "2026-11-03", to: "2026-11-05" }),
        NOW,
      );
      expect(result.items.map((i) => [i.periodStart, i.totalCents])).toEqual([
        ["2026-11-05", 0],
        ["2026-11-04", 0],
        ["2026-11-03", 0],
      ]);
      expect(result).toMatchObject({
        total: 3,
        totalCents: 0,
        paymentCount: 0,
      });
    });

    it("never lists periods after today, even for a range that ends later", async () => {
      await seed();
      const result = await service.collections(
        query("monthly", { to: "2026-12-31" }),
        NOW,
      );
      expect(result.items[0].periodStart).toBe("2026-11-01");
      expect(result.total).toBe(3);
    });

    it("pages: the page count comes from the number of periods, a page past the end is empty", async () => {
      await seed();
      const second = await service.collections(
        query("monthly", { page: 2, limit: 2 }),
        NOW,
      );
      expect(second.items.map((i) => i.periodStart)).toEqual(["2026-09-01"]);
      expect(second.total).toBe(3);
      const past = await service.collections(
        query("monthly", { page: 5, limit: 2 }),
        NOW,
      );
      expect(past.items).toEqual([]);
      expect(past.total).toBe(3);
      expect(past.totalCents).toBe(75000);
    });

    it("refuses a range that runs backwards", async () => {
      await expect(
        service.collections(
          query("daily", { from: "2026-11-05", to: "2026-11-01" }),
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("revenue by driver", () => {
    it("is empty with no payments", async () => {
      expect(await service.revenueByDriver(range())).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 8,
        totalCents: 0,
        paymentCount: 0,
      });
    });

    it("sums each driver's confirmed payments, biggest first; archived and inactive drivers are included", async () => {
      await seed();
      const result = await service.revenueByDriver(range());
      expect(
        result.items.map((i) => [
          i.name,
          i.status,
          i.archived,
          i.totalCents,
          i.paymentCount,
        ]),
      ).toEqual([
        ["Ann Driver", "active", false, 45000, 3],
        ["Bob Driver", "inactive", false, 27500, 2],
        ["Cy Driver", "active", true, 2500, 1],
      ]);
      expect(result.items[0].driverId).toBe(ann);
      expect(result.items[0].lastPaymentAt).toEqual(
        new Date("2026-11-09T14:00:00Z"),
      );
      expect(result.items[1].driverId).toBe(bob);
      expect(result.items[2].driverId).toBe(cy);
      expect(result).toMatchObject({
        total: 3,
        totalCents: 75000, // the same as the collections total
        paymentCount: 6,
      });
    });

    it("a date range keeps only the payments of those Chicago days", async () => {
      await seed();
      const result = await service.revenueByDriver(
        range({ from: "2026-11-01", to: "2026-11-02" }),
      );
      expect(result.items.map((i) => [i.name, i.totalCents])).toEqual([
        ["Bob Driver", 20000],
        ["Ann Driver", 5000], // Sunday 23:30 CST, which is Nov 2 in UTC but Nov 1 here
      ]);
      expect(result).toMatchObject({
        total: 2,
        totalCents: 25000,
        paymentCount: 2,
      });
    });

    it("a payment reassigned to another driver counts for the new one", async () => {
      await seed();
      await db.query(
        `UPDATE payments SET driver_id = $1 WHERE amount_cents = 30000`,
        [bob],
      );
      const result = await service.revenueByDriver(range());
      expect(result.items.map((i) => [i.name, i.totalCents])).toEqual([
        ["Bob Driver", 57500],
        ["Ann Driver", 15000],
        ["Cy Driver", 2500],
      ]);
    });

    it("pages with the totals of the whole range on every page", async () => {
      await seed();
      const result = await service.revenueByDriver(
        range({ page: 2, limit: 2 }),
      );
      expect(result.items.map((i) => i.name)).toEqual(["Cy Driver"]);
      expect(result).toMatchObject({ total: 3, totalCents: 75000 });
    });

    it("refuses a range that runs backwards", async () => {
      await expect(
        service.revenueByDriver(
          range({ from: "2026-11-05", to: "2026-11-01" }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
