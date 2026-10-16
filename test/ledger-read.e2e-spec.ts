import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import {
  LedgerPeriod,
  LedgerSummaryQueryDto,
} from "../src/ledger/dto/ledger-read.dto.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { Payment } from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

describe("Driver ledger: history and summaries (B77, test database)", () => {
  let db: DataSource;
  let ledger: LedgerService;
  let admin: string;
  let pat: string;
  let seq = 0;

  /**
   * Writes an entry straight into the table, so tests can use any date (the API limits manual entries to the last
   * 90 days). `cents` > 0 is a credit, < 0 a debit.
   */
  async function put(
    effectiveDate: string,
    cents: number,
    category = cents > 0 ? "discount" : "late_fee",
  ): Promise<string> {
    seq++;
    const [{ id }] = (await db.query(
      `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, category, description,
         effective_date, created_by_id, idempotency_key)
       VALUES ($1, $2, $3, 'adjustment', $4, 'test', $5, $6, $7) RETURNING id`,
      [
        pat,
        cents > 0 ? "credit" : "debit",
        Math.abs(cents),
        category,
        effectiveDate,
        admin,
        `test:${seq}`,
      ],
    )) as [{ id: string }];
    return id;
  }

  const weeks = (from: string, to: string) =>
    ledger.summary(pat, { period: LedgerPeriod.week, from, to });

  beforeAll(async () => {
    db = await openTestDatabase();
    ledger = new LedgerService(db);
  });

  beforeEach(async () => {
    await db.query("TRUNCATE ledger_entries, payments, drivers, users CASCADE");
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: pat }] = await db.getRepository(Driver).save([
      {
        firstName: "Pat",
        lastName: "Driver",
        email: "pat@test.dev",
        phone: "+13125550101",
      },
    ]);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("lists newest first by date; a backdated entry gets its running balance in date order", async () => {
    await put("2026-10-10", -5000);
    await put("2026-10-14", 3000);
    await put("2026-10-08", -1000); // recorded last, belongs first

    const page = await ledger.listPage(pat, { page: 1, limit: 20 });
    expect(page.balanceCents).toBe(-3000);
    expect(page.total).toBe(3);
    expect(
      page.items.map((i) => [i.effectiveDate, i.runningBalanceCents]),
    ).toEqual([
      ["2026-10-14", -3000],
      ["2026-10-10", -6000],
      ["2026-10-08", -1000],
    ]);
    expect(page.items[0]).toMatchObject({
      createdByEmail: "alice@admin.test",
      canReverse: true,
      reversedById: null,
    });

    // Page 2 keeps the running balance of the whole history.
    const second = await ledger.listPage(pat, { page: 2, limit: 2 });
    expect(second.items.map((i) => i.runningBalanceCents)).toEqual([-1000]);
  });

  it("a reversal shows on both rows and in the running balance", async () => {
    const fee = await put("2026-10-10", -2500);
    const reversal = await ledger.reverse(pat, fee, "Waived", admin);
    const page = await ledger.listPage(pat, { page: 1, limit: 20 });
    const original = page.items.find((i) => i.id === fee);
    expect(original).toMatchObject({
      reversedById: reversal.id,
      canReverse: false,
    });
    expect(page.items[0].runningBalanceCents).toBe(0);
  });

  it("weeks run Monday to Sunday: a Sunday entry stays in its week, Monday starts the next; empty weeks shown", async () => {
    await put("2026-10-01", -10_000); // before the range: the opening balance
    await put("2026-10-18", -2500); // Sunday
    await put("2026-10-19", 5000); // Monday
    const summary = await weeks("2026-10-12", "2026-11-01");

    expect(summary.items.map((p) => [p.start, p.end])).toEqual([
      ["2026-10-26", "2026-11-01"],
      ["2026-10-19", "2026-10-25"],
      ["2026-10-12", "2026-10-18"],
    ]);
    const [empty, second, first] = summary.items;
    expect(first).toMatchObject({
      openingCents: -10_000,
      chargesCents: 2500,
      closingCents: -12_500,
      entryCount: 1,
    });
    expect(second).toMatchObject({
      openingCents: -12_500,
      creditsCents: 5000,
      closingCents: -7500,
    });
    expect(empty).toMatchObject({
      openingCents: -7500,
      closingCents: -7500,
      entryCount: 0,
    });
  });

  it("the daylight-saving week (clocks back on Sunday 2026-11-01) is one normal week", async () => {
    await put("2026-11-01", -100); // the 25-hour Sunday
    await put("2026-11-02", -200);
    const summary = await weeks("2026-10-26", "2026-11-08");
    expect(summary.items.map((p) => [p.start, p.end, p.chargesCents])).toEqual([
      ["2026-11-02", "2026-11-08", 200],
      ["2026-10-26", "2026-11-01", 100],
    ]);
  });

  it("months split on the 1st; reversals are a signed column of their own", async () => {
    const fee = await put("2026-09-30", -2500);
    await put("2026-10-31", -1000, "toll");
    // Reversal of the September fee, made "today" but backdated here by hand to land in November.
    await db.query(
      `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, description, effective_date,
         reversal_of_id, created_by_id, idempotency_key)
       VALUES ($1, 'credit', 2500, 'reversal', 'Reversal: Waived', '2026-11-01', $2, $3, 'test:rev')`,
      [pat, fee, admin],
    );
    const summary = await ledger.summary(pat, {
      period: LedgerPeriod.month,
      from: "2026-09-15",
      to: "2026-11-30",
    });
    expect(
      summary.items.map((p) => [
        p.start,
        p.end,
        p.chargesCents,
        p.reversalsCents,
        p.closingCents,
      ]),
    ).toEqual([
      ["2026-11-01", "2026-11-30", 0, 2500, -1000],
      ["2026-10-01", "2026-10-31", 1000, 0, -3500],
      ["2026-09-01", "2026-09-30", 2500, 0, -2500],
    ]);
  });

  it("defaults to 12 periods ending today; refuses bad ranges", async () => {
    expect(
      (await ledger.summary(pat, { period: LedgerPeriod.week })).items,
    ).toHaveLength(12);
    await expect(weeks("2026-11-01", "2026-10-01")).rejects.toThrow(
      BadRequestException,
    );
    await expect(weeks("2026-02-30", "2026-03-10")).rejects.toThrow(
      BadRequestException,
    );
    await expect(weeks("2020-01-01", "2026-10-01")).rejects.toThrow(
      BadRequestException,
    );
    expect(
      validateSync(plainToInstance(LedgerSummaryQueryDto, { period: "year" })),
    ).not.toHaveLength(0);
  });

  it("the drivers list and detail carry the ledger balance", async () => {
    await put("2026-10-10", -4200);
    const drivers = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
    expect((await drivers.findOne(pat)).balanceCents).toBe(-4200);
  });
});
