import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { addDays, chicagoDate } from "../src/common/chicago-date.js";
import { Driver } from "../src/drivers/driver.entity.js";
import {
  LedgerListQueryDto,
  LedgerOrder,
  LedgerTypeFilter,
} from "../src/ledger/dto/ledger-read.dto.js";
import { LedgerDirection } from "../src/ledger/ledger-entry.entity.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { PaymentManualMethod } from "../src/payments/payment.entity.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import { openTestDatabase } from "./test-database.js";

describe("Driver ledger page: filters, refs, credit against a charge (B86, test database)", () => {
  let db: DataSource;
  let ledger: LedgerService;
  let payments: PaymentsService;
  let admin: string;
  let pat: string;
  let sam: string;

  const today = chicagoDate(new Date());
  const ago = (days: number) => addDays(today, -days);

  /** A manual entry through the real service: `cents` > 0 is a credit, < 0 a charge. */
  function add(
    cents: number,
    daysAgo: number,
    reason: string,
    extra: { driver?: string; appliesToId?: string } = {},
  ) {
    return ledger.addManualEntry(
      extra.driver ?? pat,
      {
        direction: cents > 0 ? LedgerDirection.credit : LedgerDirection.debit,
        amountCents: Math.abs(cents),
        effectiveDate: ago(daysAgo),
        reason,
        requestKey: randomUUID(),
        appliesToId: extra.appliesToId,
      },
      admin,
    );
  }

  const list = (query: Partial<LedgerListQueryDto> = {}) =>
    ledger.listPage(pat, { page: 1, limit: 50, ...query });

  beforeAll(async () => {
    db = await openTestDatabase();
    ledger = new LedgerService(db);
    payments = new PaymentsService(db, ledger);
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE ledger_entries, payments, payment_aliases, drivers, users CASCADE",
    );
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [pat, sam] = (
      await db.getRepository(Driver).save([
        {
          firstName: "Pat",
          lastName: "Driver",
          email: "pat@test.dev",
          phone: "+13125550101",
        },
        {
          firstName: "Sam",
          lastName: "Other",
          email: "sam@test.dev",
          phone: "+13125550102",
        },
      ])
    ).map((d) => d.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** A charge, a credit, a payment and a reversal on Pat's ledger. */
  async function seed() {
    const flat = await add(-8500, 20, "Flat tire, rear left");
    await add(-2500, 12, "Late fee");
    await add(4000, 10, "Referral discount");
    await payments.recordManual(
      {
        driverId: pat,
        method: PaymentManualMethod.cash,
        amountCents: 3000,
        paidOn: ago(5),
        requestKey: randomUUID(),
      },
      admin,
    );
    const reversal = await ledger.reverse(pat, flat.id, "Entered twice", admin);
    return { flat, reversal };
  }

  describe("filters", () => {
    it("filters by type", async () => {
      await seed();
      const kinds = async (type: LedgerTypeFilter) =>
        (await list({ type })).items.map((i) => [i.kind, i.direction]);

      expect(await kinds(LedgerTypeFilter.charges)).toHaveLength(2);
      expect(await kinds(LedgerTypeFilter.credits)).toEqual([
        ["adjustment", "credit"],
      ]);
      expect(await kinds(LedgerTypeFilter.payments)).toEqual([
        ["payment", "credit"],
      ]);
      expect(await kinds(LedgerTypeFilter.reversals)).toEqual([
        ["reversal", "credit"],
      ]);
      expect((await list()).total).toBe(5);
    });

    it("filters by the days the entries belong to, both ends included, and refuses from after to", async () => {
      await seed();
      const page = await list({ from: ago(12), to: ago(10) });
      expect(page.items.map((i) => i.effectiveDate).sort()).toEqual([
        ago(12),
        ago(10),
      ]);
      await expect(list({ from: ago(1), to: ago(5) })).rejects.toThrow(
        /is after the "to" date/,
      );
    });

    it("gives the balance before `from` for a statement, and null without it", async () => {
      await seed();
      // Before day -10: the flat tire (-85) and the late fee (-25).
      expect((await list({ from: ago(10) })).balanceBeforeCents).toBe(-11000);
      expect((await list()).balanceBeforeCents).toBeNull();
    });

    it("searches the description and the admin's email, case-insensitively, and treats % as plain text", async () => {
      await seed();
      const ids = async (search: string) =>
        (await list({ search })).items.map((i) => i.description);
      expect(await ids("FLAT")).toEqual(["Flat tire, rear left"]);
      expect(await ids("entered twice")).toEqual(["Reversal: Entered twice"]);
      expect(await ids("alice@admin")).toHaveLength(5);
      expect(await ids("nothing like this")).toEqual([]);
    });

    it("finds the entries of exactly the amount typed, with or without $ and cents, not ones that merely contain it", async () => {
      const { flat, reversal } = await seed();
      const found = async (text: string) =>
        (await list({ search: text })).items.map((i) => i.description);
      // The $85 charge and the reversal that cancels it.
      expect(
        (await list({ search: "85" })).items.map((i) => i.id).sort(),
      ).toEqual([flat.id, reversal.id].sort());
      expect((await list({ search: "$85.00" })).total).toBe(2);
      expect(await found("25")).toEqual(["Late fee"]);
      expect(await found("40.00")).toEqual(["Referral discount"]);
      expect((await list({ search: "30" })).items.map((i) => i.kind)).toEqual([
        "payment",
      ]);
      // $8.50, $850 and $8 are other amounts than $85: no "contains" matching on the number.
      expect(await found("8.50")).toEqual([]);
      expect(await found("850")).toEqual([]);
      expect(await found("8")).toEqual([]);
      // An amount past the database's integer is just text, not an error.
      expect(await found("99999999999")).toEqual([]);
    });

    it("finds an entry by its reference", async () => {
      const { flat, reversal } = await seed();
      const byRef = async (text: string) =>
        (await list({ search: text })).items.map((i) => i.id);
      expect(await byRef(flat.ref)).toEqual([flat.id]);
      expect(await byRef(flat.ref.toLowerCase().replace("-", ""))).toEqual([
        flat.id,
      ]);
      expect(await byRef(reversal.ref)).toEqual([reversal.id]);
      expect(await byRef("CH-999999")).toEqual([]);
      expect(await byRef("100%")).toEqual([]);
    });
  });

  describe("order, running balance and totals", () => {
    it("oldest first flips the order, and a filter never changes a row's balance", async () => {
      await seed();
      const all = await list();
      const asc = await list({ order: LedgerOrder.asc });
      expect(asc.items.map((i) => i.id)).toEqual(
        all.items.map((i) => i.id).reverse(),
      );

      const balanceOf = new Map(
        all.items.map((i) => [i.id, i.runningBalanceCents]),
      );
      const charges = await list({ type: LedgerTypeFilter.charges });
      for (const row of charges.items) {
        expect(row.runningBalanceCents).toBe(balanceOf.get(row.id));
      }
      // The newest row's balance is the balance now.
      expect(all.items[0].runningBalanceCents).toBe(all.balanceCents);
    });

    it("totals cover every filtered entry, not only the page", async () => {
      await seed();
      const page = await list({ limit: 1, page: 2 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(5);
      // Debits: 8500 + 2500. Credits: 4000 + 3000 + the 8500 reversal.
      expect(page.totals).toEqual({ debitCents: 11000, creditCents: 15500 });
      expect(page.balanceCents).toBe(4500);

      const chargesOnly = await list({
        type: LedgerTypeFilter.charges,
        limit: 1,
      });
      expect(chargesOnly.totals).toEqual({ debitCents: 11000, creditCents: 0 });
    });
  });

  describe("references and links", () => {
    it("gives every entry a reference and links reversals and credits to each other", async () => {
      const late = await add(-2500, 3, "Late fee");
      const credit = await add(2500, 1, "Waived", { appliesToId: late.id });
      const reversal = await ledger.reverse(pat, credit.id, "Oops", admin);

      expect(late.ref).toMatch(/^CH-\d+$/);
      expect(credit.ref).toMatch(/^CR-\d+$/);
      expect(reversal.ref).toMatch(/^RV-\d+$/);
      expect(
        new Set([late.entryNo, credit.entryNo, reversal.entryNo]).size,
      ).toBe(3);

      const rows = new Map((await list()).items.map((i) => [i.id, i]));
      expect(rows.get(credit.id)).toMatchObject({
        appliesToRef: late.ref,
        appliesToId: late.id,
        reversedByRef: reversal.ref,
      });
      expect(rows.get(reversal.id)).toMatchObject({
        reversalOfRef: credit.ref,
      });
    });
  });

  describe("credit against a charge", () => {
    it("tracks what is left to credit, and a full credit leaves nothing", async () => {
      const late = await add(-2500, 3, "Late fee");
      const creditable = async () =>
        (await list()).items.find((i) => i.id === late.id)?.creditableCents;

      expect(await creditable()).toBe(2500);
      await add(1000, 1, "Part waived", { appliesToId: late.id });
      expect(await creditable()).toBe(1500);
      await add(1500, 1, "Rest waived", { appliesToId: late.id });
      expect(await creditable()).toBeNull();
      expect((await list()).balanceCents).toBe(0);
    });

    it("refuses more than is left, naming the charge and the amount", async () => {
      const late = await add(-2500, 3, "Late fee");
      await add(1000, 1, "Part waived", { appliesToId: late.id });
      await expect(
        add(1501, 1, "Too much", { appliesToId: late.id }),
      ).rejects.toThrow(`At most $15.00 is left to credit on ${late.ref}.`);
    });

    it("refuses a charge that is not a charge: a debit, a credit, a payment, a reversed charge", async () => {
      const late = await add(-2500, 3, "Late fee");
      const credit = await add(500, 2, "Discount");
      await expect(
        ledger.addManualEntry(
          pat,
          {
            direction: LedgerDirection.debit,
            amountCents: 100,
            effectiveDate: today,
            reason: "x",
            requestKey: randomUUID(),
            appliesToId: late.id,
          },
          admin,
        ),
      ).rejects.toThrow("Only a credit can be applied against a charge.");
      await expect(
        add(100, 1, "x", { appliesToId: credit.id }),
      ).rejects.toThrow("Only a charge can be credited against.");

      const payment = await payments.recordManual(
        {
          driverId: pat,
          method: PaymentManualMethod.cash,
          amountCents: 700,
          paidOn: today,
          requestKey: randomUUID(),
        },
        admin,
      );
      const paymentEntry = (await list({ type: LedgerTypeFilter.payments }))
        .items[0];
      expect(paymentEntry.paymentId).toBe(payment.id);
      await expect(
        add(100, 1, "x", { appliesToId: paymentEntry.id }),
      ).rejects.toThrow("Only a charge can be credited against.");

      await ledger.reverse(pat, late.id, "Mistake", admin);
      await expect(add(100, 1, "x", { appliesToId: late.id })).rejects.toThrow(
        /was reversed/,
      );
    });

    it("does not find another driver's charge", async () => {
      const theirs = await add(-2500, 3, "Late fee", { driver: sam });
      await expect(
        add(100, 1, "x", { appliesToId: theirs.id }),
      ).rejects.toThrow("Charge not found.");
    });

    it("answers a repeated request with the entry already made, even when it used up the charge", async () => {
      const late = await add(-2500, 3, "Late fee");
      const request = {
        direction: LedgerDirection.credit,
        amountCents: 2500,
        effectiveDate: today,
        reason: "Waived",
        requestKey: randomUUID(),
        appliesToId: late.id,
      };
      const first = await ledger.addManualEntry(pat, request, admin);
      const again = await ledger.addManualEntry(pat, request, admin);
      expect(again.id).toBe(first.id);
      expect((await list()).total).toBe(2);
      await expect(
        ledger.addManualEntry(pat, { ...request, reason: "Other" }, admin),
      ).rejects.toThrow("already used for a different entry");
    });

    it("lets two admins credit the same charge at the same time without crediting more than it was", async () => {
      const late = await add(-2500, 3, "Late fee");
      const results = await Promise.allSettled([
        add(2500, 1, "Admin one", { appliesToId: late.id }),
        add(2500, 1, "Admin two", { appliesToId: late.id }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await list()).balanceCents).toBe(0);
    });

    it("refuses to reverse a charge that still has credits, and allows it once they are reversed", async () => {
      const late = await add(-2500, 3, "Late fee");
      const credit = await add(1000, 1, "Part waived", {
        appliesToId: late.id,
      });
      await expect(
        ledger.reverse(pat, late.id, "Mistake", admin),
      ).rejects.toThrow(`Reverse the credits applied to ${late.ref} first.`);

      await ledger.reverse(pat, credit.id, "Undo", admin);
      await ledger.reverse(pat, late.id, "Mistake", admin);
      expect((await list()).balanceCents).toBe(0);
    });
  });
  describe("internal note (staff only)", () => {
    const withNote = (
      cents: number,
      note: string | undefined,
      key = randomUUID(),
    ) =>
      ledger.addManualEntry(
        pat,
        {
          direction: cents > 0 ? LedgerDirection.credit : LedgerDirection.debit,
          amountCents: Math.abs(cents),
          effectiveDate: today,
          reason: "Flat tire",
          requestKey: key,
          internalNote: note,
        },
        admin,
      );

    it("keeps the note on the entry and returns it in the list and the details", async () => {
      const entry = await withNote(-8500, "Receipt in the glovebox");
      expect(entry.internalNote).toBe("Receipt in the glovebox");

      const row = (await list()).items.find((i) => i.id === entry.id);
      expect(row?.internalNote).toBe("Receipt in the glovebox");
      expect(
        (await ledger.entryDetails(pat, entry.id)).entry.internalNote,
      ).toBe("Receipt in the glovebox");
    });

    it("has no note when none is given, and the search finds a note", async () => {
      const plain = await withNote(-100, undefined);
      expect(plain.internalNote).toBeNull();
      await withNote(-200, "Call the body shop");

      const found = await list({ search: "BODY shop" });
      expect(found.items.map((i) => i.internalNote)).toEqual([
        "Call the body shop",
      ]);
    });

    it("answers a repeated request with the same note, and refuses the key for another note", async () => {
      const key = randomUUID();
      const first = await withNote(-8500, "Note A", key);
      const again = await withNote(-8500, "Note A", key);
      expect(again.id).toBe(first.id);
      await expect(withNote(-8500, "Note B", key)).rejects.toThrow(
        "already used for a different entry",
      );
    });

    it("the database refuses a blank note and one over 500 characters", async () => {
      await expect(
        db.query(
          `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, description, effective_date,
             internal_note, created_by_id, idempotency_key)
           VALUES ($1, 'debit', 100, 'adjustment', 'x', CURRENT_DATE, $2, $3, 'test:note-long')`,
          [pat, "x".repeat(501), admin],
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, description, effective_date,
             internal_note, created_by_id, idempotency_key)
           VALUES ($1, 'debit', 100, 'adjustment', 'x', CURRENT_DATE, '   ', $2, 'test:note-blank')`,
          [pat, admin],
        ),
      ).rejects.toThrow();
    });
  });
});
