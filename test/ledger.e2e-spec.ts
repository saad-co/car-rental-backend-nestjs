import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import { addDays, chicagoDate } from "../src/common/chicago-date.js";
import { Driver } from "../src/drivers/driver.entity.js";
import {
  CreateLedgerEntryDto,
  ReverseLedgerEntryDto,
} from "../src/ledger/dto/ledger-entry.dto.js";
import {
  LedgerDirection,
  LedgerEntry,
} from "../src/ledger/ledger-entry.entity.js";
import { LedgerController } from "../src/ledger/ledger.controller.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { openTestDatabase } from "./test-database.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

/** The body fields as a plain object type (the DTO is a class; spreading a class instance loses its prototype). */
type EntryBody = { [K in keyof CreateLedgerEntryDto]: CreateLedgerEntryDto[K] };

describe("Driver ledger: manual entries and reversals (B77, test database)", () => {
  let db: DataSource;
  let ledger: LedgerService;
  let admin: string;
  let pat: string;
  let sam: string;
  const today = () => chicagoDate(new Date());

  /** A valid manual entry; override any field. */
  const entry = (overrides: Partial<EntryBody> = {}): EntryBody => ({
    direction: LedgerDirection.debit,
    amountCents: 2500,
    effectiveDate: today(),
    reason: "Late fee",
    requestKey: randomUUID(),
    ...overrides,
  });

  beforeAll(async () => {
    db = await openTestDatabase();
    ledger = new LedgerService(db);
  });

  beforeEach(async () => {
    await db.query("TRUNCATE ledger_entries, payments, drivers, users CASCADE");
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    const drivers = await db.getRepository(Driver).save([
      {
        firstName: "Pat",
        lastName: "Driver",
        email: "pat@test.dev",
        phone: "+13125550101",
      },
      {
        firstName: "Sam",
        lastName: "Driver",
        email: "sam@test.dev",
        phone: "+13125550102",
      },
    ]);
    [pat, sam] = drivers.map((d) => d.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("balance is credits minus debits, from the entries", async () => {
    expect(await ledger.balanceCents(pat)).toBe(0);
    await ledger.addManualEntry(pat, entry({ amountCents: 2500 }), admin);
    await ledger.addManualEntry(
      pat,
      entry({ amountCents: 12_000, reason: "Flat tire" }),
      admin,
    );
    const credit = await ledger.addManualEntry(
      pat,
      entry({
        direction: LedgerDirection.credit,
        amountCents: 1000,
        reason: "Discount",
      }),
      admin,
    );
    expect(credit).toMatchObject({
      direction: LedgerDirection.credit,
      kind: "adjustment",
      createdByEmail: "alice@admin.test",
      canReverse: true,
    });
    expect(await ledger.balanceCents(pat)).toBe(-13_500);
    expect(await ledger.balanceCents(sam)).toBe(0);
  });

  it("a reversal cancels the entry, dated today, and can happen only once", async () => {
    const fee = await ledger.addManualEntry(
      pat,
      entry({ effectiveDate: addDays(today(), -10) }),
      admin,
    );
    const reversal = await ledger.reverse(pat, fee.id, "Waived", admin);
    expect(reversal).toMatchObject({
      direction: LedgerDirection.credit,
      amountCents: 2500,
      kind: "reversal",
      reversalOfId: fee.id,
      effectiveDate: today(),
      description: "Reversal: Waived",
      canReverse: false,
    });
    expect(await ledger.balanceCents(pat)).toBe(0);
    expect((await ledger.findDto(fee.id)).reversedById).toBe(reversal.id);

    await expect(ledger.reverse(pat, fee.id, "Again", admin)).rejects.toThrow(
      ConflictException,
    );
    await expect(
      ledger.reverse(pat, reversal.id, "Undo", admin),
    ).rejects.toThrow(ConflictException);
  });

  it("two admins reversing the same entry at once: exactly one reversal", async () => {
    const fee = await ledger.addManualEntry(pat, entry(), admin);
    const results = await Promise.allSettled([
      ledger.reverse(pat, fee.id, "A", admin),
      ledger.reverse(pat, fee.id, "B", admin),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
    expect(await ledger.balanceCents(pat)).toBe(0);
  });

  it("an entry of another driver, or an unknown one, is 404", async () => {
    const fee = await ledger.addManualEntry(pat, entry(), admin);
    await expect(ledger.reverse(sam, fee.id, "x", admin)).rejects.toThrow(
      NotFoundException,
    );
    await expect(ledger.reverse(pat, UNKNOWN_ID, "x", admin)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      ledger.addManualEntry(UNKNOWN_ID, entry(), admin),
    ).rejects.toThrow(NotFoundException);
  });

  it("the same request key twice makes one entry; reused for something else is 409", async () => {
    const first = entry();
    const a = await ledger.addManualEntry(pat, first, admin);
    const b = await ledger.addManualEntry(pat, { ...first }, admin);
    expect(b.id).toBe(a.id);
    expect(await db.getRepository(LedgerEntry).count()).toBe(1);

    await expect(
      ledger.addManualEntry(pat, { ...first, amountCents: 9999 }, admin),
    ).rejects.toThrow(ConflictException);
  });

  it("dates: today and 90 days back are fine; the future, 91 days back or a fake day are refused", async () => {
    await ledger.addManualEntry(pat, entry({ effectiveDate: today() }), admin);
    await ledger.addManualEntry(
      pat,
      entry({ effectiveDate: addDays(today(), -90) }),
      admin,
    );
    for (const effectiveDate of [
      addDays(today(), 1),
      addDays(today(), -91),
      "2026-02-30",
    ]) {
      await expect(
        ledger.addManualEntry(pat, entry({ effectiveDate }), admin),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it("direction decides the sign: a charge makes the driver owe, a credit owe less", async () => {
    await ledger.addManualEntry(pat, entry({ amountCents: 4000 }), admin);
    const credit = await ledger.addManualEntry(
      pat,
      entry({ direction: LedgerDirection.credit, amountCents: 1500 }),
      admin,
    );
    expect(credit.direction).toBe(LedgerDirection.credit);
    expect(await ledger.balanceCents(pat)).toBe(-2500);
  });

  it("the database itself refuses UPDATE and DELETE (append-only)", async () => {
    const fee = await ledger.addManualEntry(pat, entry(), admin);
    await expect(
      db.query(`UPDATE ledger_entries SET amount_cents = 1 WHERE id = $1`, [
        fee.id,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(`DELETE FROM ledger_entries WHERE id = $1`, [fee.id]),
    ).rejects.toThrow(/append-only/);
  });

  it("validates the request bodies", () => {
    const errorsFor = (plain: object) =>
      validateSync(plainToInstance(CreateLedgerEntryDto, plain));
    const good = { ...entry() };
    expect(errorsFor(good)).toHaveLength(0);
    for (const bad of [
      { amountCents: 0 },
      { amountCents: -500 },
      { amountCents: 12.5 },
      { amountCents: 1_000_001 },
      { amountCents: "2500" },
      { reason: "   " },
      { reason: "x".repeat(501) },
      { effectiveDate: "17/10/2026" },
      { direction: "refund" },
      { direction: undefined },
      { requestKey: "abc" },
    ]) {
      expect(errorsFor({ ...good, ...bad })).not.toHaveLength(0);
    }
    const reverse = plainToInstance(ReverseLedgerEntryDto, { reason: "  x " });
    expect(validateSync(reverse)).toHaveLength(0);
    expect(reverse.reason).toBe("x");
    expect(
      validateSync(plainToInstance(ReverseLedgerEntryDto, { reason: " " })),
    ).not.toHaveLength(0);
  });

  it("the routes are admin-only: not public, not opened to drivers", () => {
    for (const handler of [
      /* eslint-disable @typescript-eslint/unbound-method -- read as metadata, never called */
      LedgerController.prototype.addEntry,
      LedgerController.prototype.reverse,
      /* eslint-enable @typescript-eslint/unbound-method */
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, LedgerController),
    ).toBeUndefined();
  });
});
