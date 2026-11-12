import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { addDays, chicagoDate } from "../src/common/chicago-date.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { EditLedgerEntryDto } from "../src/ledger/dto/ledger-entry.dto.js";
import {
  LedgerDirection,
  LedgerEntry,
} from "../src/ledger/ledger-entry.entity.js";
import { LedgerController } from "../src/ledger/ledger.controller.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import {
  MatchMethod,
  Payment,
  PaymentManualMethod,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import { openTestDatabase } from "./test-database.js";

describe("Driver ledger: editing an entry (Fleet revisions section 5, test database)", () => {
  let db: DataSource;
  let ledger: LedgerService;
  let admin: string;
  let pat: string;
  const today = () => chicagoDate(new Date());

  const charge = (amountCents: number, reason = "Late fee") =>
    ledger.addManualEntry(
      pat,
      {
        direction: LedgerDirection.debit,
        amountCents,
        effectiveDate: today(),
        reason,
        requestKey: randomUUID(),
      },
      admin,
    );

  const balance = async () =>
    Number(
      (
        (await db.query(
          `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS b
           FROM ledger_entries WHERE driver_id = $1`,
          [pat],
        )) as [{ b: string }]
      )[0].b,
    );

  const auditLines = () =>
    db.query(
      `SELECT actor_id, actor_email, action, entity_type, entity_id, before, after FROM audit_logs ORDER BY created_at, id`,
    ) as Promise<
      {
        actor_id: string;
        actor_email: string;
        action: string;
        entity_type: string;
        entity_id: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }[]
    >;

  /** A confirmed payment (the credit is written the way matching writes it). */
  async function addPayment(
    source: PaymentSource,
    amountCents: number,
  ): Promise<string> {
    const manual = source === PaymentSource.manual;
    const result = await db.getRepository(Payment).insert({
      source,
      externalId: `ext-${randomUUID()}`,
      manualMethod: manual ? PaymentManualMethod.cash : null,
      description: manual ? "Cash at pickup" : null,
      internalNote: manual ? "Counted twice" : null,
      amountCents,
      senderName: manual ? "Pat" : "Pat Venmo",
      senderHandle: null,
      // 04:30 UTC on the 19th = 11:30 PM on the 18th in Chicago.
      occurredAt: new Date("2026-10-19T04:30:00Z"),
      extractionConfidence: 1,
      status: PaymentStatus.confirmed,
      driverId: pat,
      matchMethod: MatchMethod.manual,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await db.transaction((manager) =>
      ledger.syncPaymentCredit(manager, id, admin),
    );
    return id;
  }

  beforeAll(async () => {
    db = await openTestDatabase();
    ledger = new LedgerService(db);
  });

  beforeEach(async () => {
    await db.query("TRUNCATE ledger_entries, payments, drivers, users CASCADE");
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    const [driver] = await db.getRepository(Driver).save([
      {
        firstName: "Pat",
        lastName: "Driver",
        email: "pat@test.dev",
        phone: "+13125550101",
      },
    ]);
    pat = driver.id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("a charge is edited in place: the same row changes, nothing is added, the balance moves by the difference, and the audit line says who, what, old and new", async () => {
    const original = await charge(2500);
    expect(await balance()).toBe(-2500);

    const edited = await ledger.edit(
      pat,
      original.id,
      { amountCents: 3000, description: "Late fee (two days)" },
      admin,
    );

    expect(await balance()).toBe(-3000);
    expect(edited).toMatchObject({
      id: original.id,
      direction: "debit",
      amountCents: 3000,
      description: "Late fee (two days)",
      kind: "adjustment",
      canEdit: true,
    });
    // Still one row: no reversal, no second entry.
    const rows = await db.getRepository(LedgerEntry).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: original.id,
      amountCents: 3000,
      description: "Late fee (two days)",
    });
    const [line, ...others] = await auditLines();
    expect(others).toHaveLength(0);
    expect(line).toMatchObject({
      actor_id: admin,
      actor_email: "alice@admin.test",
      action: "ledger_entry.edit",
      entity_type: "ledger_entry",
      entity_id: original.id,
      before: { amountCents: 2500, description: "Late fee" },
      after: { amountCents: 3000, description: "Late fee (two days)" },
    });
    // It can be edited again, and the audit trail keeps every step.
    const again = await ledger.edit(
      pat,
      original.id,
      { amountCents: 3500 },
      admin,
    );
    expect(again.amountCents).toBe(3500);
    expect(await balance()).toBe(-3500);
    expect(await auditLines()).toHaveLength(2);
  });

  it("the database still refuses any other UPDATE, a DELETE, and a change of anything but the four editable columns, even with the edit switched on", async () => {
    const original = await charge(2500);
    await expect(
      db.query(`UPDATE ledger_entries SET amount_cents = 1 WHERE id = $1`, [
        original.id,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(`DELETE FROM ledger_entries WHERE id = $1`, [original.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.ledger_edit', 'on', true)`);
        await manager.query(
          `UPDATE ledger_entries SET direction = 'credit' WHERE id = $1`,
          [original.id],
        );
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.ledger_edit', 'on', true)`);
        await manager.query(`DELETE FROM ledger_entries WHERE id = $1`, [
          original.id,
        ]);
      }),
    ).rejects.toThrow(/append-only/);
    // The switch ends with the transaction: a later plain UPDATE is refused again.
    await ledger.edit(pat, original.id, { amountCents: 2600 }, admin);
    await expect(
      db.query(`UPDATE ledger_entries SET amount_cents = 1 WHERE id = $1`, [
        original.id,
      ]),
    ).rejects.toThrow(/append-only/);
    expect(await balance()).toBe(-2600);
  });

  it("the date and the memo can be corrected; an empty memo clears it", async () => {
    const original = await ledger.addManualEntry(
      pat,
      {
        direction: LedgerDirection.credit,
        amountCents: 1000,
        effectiveDate: today(),
        reason: "Discount",
        requestKey: randomUUID(),
        internalNote: "owner said ok",
      },
      admin,
    );
    const yesterday = addDays(today(), -1);

    const edited = await ledger.edit(
      pat,
      original.id,
      { effectiveDate: yesterday, internalNote: "" },
      admin,
    );

    expect(edited).toMatchObject({
      effectiveDate: yesterday,
      internalNote: null,
      amountCents: 1000,
    });
    expect(await balance()).toBe(1000);
    const [line] = await auditLines();
    expect(line.before).toMatchObject({ internalNote: "owner said ok" });
    expect(line.after).toMatchObject({
      effectiveDate: yesterday,
      internalNote: null,
    });
  });

  it("refuses nothing changed, a future date, a reversal, a reversed entry, an unknown entry; no audit line is left behind", async () => {
    const original = await charge(2500);
    await expect(
      ledger.edit(pat, original.id, { amountCents: 2500 }, admin),
    ).rejects.toThrow(/Nothing was changed/);
    await expect(
      ledger.edit(
        pat,
        original.id,
        { effectiveDate: addDays(today(), 1) },
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ledger.edit(pat, original.id, { effectiveDate: "2026-02-30" }, admin),
    ).rejects.toThrow(BadRequestException);
    const reversal = await ledger.reverse(pat, original.id, "mistake", admin);
    await expect(
      ledger.edit(pat, reversal.id, { amountCents: 100 }, admin),
    ).rejects.toThrow(/reversal cannot be edited/);
    await expect(
      ledger.edit(pat, original.id, { amountCents: 100 }, admin),
    ).rejects.toThrow(/was reversed/);
    await expect(
      ledger.edit(
        pat,
        "00000000-0000-0000-0000-000000000000",
        { amountCents: 100 },
        admin,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(await auditLines()).toHaveLength(0);
  });

  it("a charge cannot drop below the credits applied to it (its other fields can change); a credit cannot grow past what is left on its charge", async () => {
    const fee = await charge(2500, "Late fee");
    const waiver = await ledger.addManualEntry(
      pat,
      {
        direction: LedgerDirection.credit,
        amountCents: 1000,
        effectiveDate: today(),
        reason: "Part waived",
        requestKey: randomUUID(),
        appliesToId: fee.id,
      },
      admin,
    );

    // $10.00 of credit is applied to the $25.00 charge: it may become $10.00, not $9.99.
    await expect(
      ledger.edit(pat, fee.id, { amountCents: 999 }, admin),
    ).rejects.toThrow(/cannot be less than that/);
    const shrunk = await ledger.edit(pat, fee.id, { amountCents: 1000 }, admin);
    expect(shrunk.amountCents).toBe(1000);
    const described = await ledger.edit(
      pat,
      fee.id,
      { description: "Late fee, reworded" },
      admin,
    );
    expect(described.description).toBe("Late fee, reworded");
    // The credit may become the whole charge ($10.00), not more.
    await expect(
      ledger.edit(pat, waiver.id, { amountCents: 1001 }, admin),
    ).rejects.toThrow(/At most \$10\.00 can be credited/);
    expect(await balance()).toBe(0);
    expect(await auditLines()).toHaveLength(2);

    // Grow the charge back, then the credit up to it.
    await ledger.edit(pat, fee.id, { amountCents: 2500 }, admin);
    const fixed = await ledger.edit(
      pat,
      waiver.id,
      { amountCents: 2500 },
      admin,
    );
    expect(fixed.appliesToId).toBe(fee.id);
    expect(await balance()).toBe(0);
  });

  it("a payment recorded by hand is corrected on the payment itself: amount, date and text, and its credit changes in place", async () => {
    const paymentId = await addPayment(PaymentSource.manual, 5000);
    const [credit] = await db.getRepository(LedgerEntry).find();
    expect(await balance()).toBe(5000);

    const edited = await ledger.edit(
      pat,
      credit.id,
      {
        amountCents: 4000,
        effectiveDate: "2026-10-15",
        description: "Cash at pickup, corrected",
      },
      admin,
    );

    expect(await balance()).toBe(4000);
    expect(edited).toMatchObject({
      id: credit.id,
      kind: "payment",
      amountCents: 4000,
      effectiveDate: "2026-10-15",
      description: "Cash at pickup, corrected",
      paymentId,
    });
    expect(await db.getRepository(LedgerEntry).count()).toBe(1);
    const payment = await db.getRepository(Payment).findOneByOrFail({
      id: paymentId,
    });
    expect(payment.amountCents).toBe(4000);
    expect(chicagoDate(payment.occurredAt)).toBe("2026-10-15");
    expect(payment.description).toBe("Cash at pickup, corrected");
    const [line] = await auditLines();
    expect(line).toMatchObject({
      action: "ledger_entry.edit",
      entity_id: credit.id,
      before: { amountCents: 5000, effectiveDate: "2026-10-18" },
      after: { amountCents: 4000, effectiveDate: "2026-10-15" },
    });
    // A later void reverses the credit at its corrected amount.
    await db.transaction(async (manager) => {
      await manager.update(
        Payment,
        { id: paymentId },
        {
          status: PaymentStatus.rejected,
        },
      );
      await ledger.syncPaymentCredit(manager, paymentId, admin, "test");
    });
    expect(await balance()).toBe(0);
  });

  it("a payment from an email can change its amount and date, but not text it does not have", async () => {
    await addPayment(PaymentSource.email_venmo, 5800);
    const [credit] = await db.getRepository(LedgerEntry).find();

    await expect(
      ledger.edit(pat, credit.id, { description: "Something else" }, admin),
    ).rejects.toThrow(/amount, date and memo only/);
    expect(await auditLines()).toHaveLength(0);

    const edited = await ledger.edit(
      pat,
      credit.id,
      { amountCents: 5000 },
      admin,
    );
    expect(edited.amountCents).toBe(5000);
    expect(edited.description).toBe("Venmo payment from Pat Venmo");
    expect(await balance()).toBe(5000);

    // A memo can go on it too (Fleet revisions section 5: a memo on every payment).
    const withMemo = await ledger.edit(
      pat,
      credit.id,
      { internalNote: "Driver paid for a friend" },
      admin,
    );
    expect(withMemo.internalNote).toBe("Driver paid for a friend");
    expect(await balance()).toBe(5000);
  });

  it("two admins editing the same entry at once: both are applied one after the other, each audited", async () => {
    const original = await charge(2500);
    const results = await Promise.allSettled([
      ledger.edit(pat, original.id, { amountCents: 3000 }, admin),
      ledger.edit(pat, original.id, { amountCents: 3500 }, admin),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await auditLines()).toHaveLength(2);
    expect([-3000, -3500]).toContain(await balance());
    expect(await db.getRepository(LedgerEntry).count()).toBe(1);
  });

  it("validates the body and the route is admin-only", () => {
    const check = (raw: object) =>
      validateSync(plainToInstance(EditLedgerEntryDto, raw), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).map((e) => e.property);
    expect(check({ amountCents: 0 })).toEqual(["amountCents"]);
    expect(check({ amountCents: 1_000_001 })).toEqual(["amountCents"]);
    expect(check({ amountCents: 12.5 })).toEqual(["amountCents"]);
    expect(check({ effectiveDate: "10/15/2026" })).toEqual(["effectiveDate"]);
    expect(check({ description: "   " })).toEqual(["description"]);
    expect(check({ internalNote: "" })).toEqual([]);
    expect(check({ amountCents: 100, extra: 1 })).toEqual(["extra"]);

    const handler = (
      LedgerController.prototype as unknown as Record<string, object>
    ).edit;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });
});
