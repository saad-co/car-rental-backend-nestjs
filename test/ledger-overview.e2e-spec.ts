import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { addDays, chicagoDate } from "../src/common/chicago-date.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { LedgerDirection } from "../src/ledger/ledger-entry.entity.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import {
  PaymentManualMethod,
  PaymentSource,
} from "../src/payments/payment.entity.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import { openTestDatabase } from "./test-database.js";

describe("Driver ledger page: overview and entry details (B86, test database)", () => {
  let db: DataSource;
  let ledger: LedgerService;
  let payments: PaymentsService;
  let admin: string;
  let pat: string;
  let sam: string;

  const today = chicagoDate(new Date());
  const ago = (days: number) => addDays(today, -days);

  /** `cents` > 0 is a credit, < 0 a charge, dated `daysAgo` days back. */
  function add(
    cents: number,
    daysAgo: number,
    reason: string,
    appliesToId?: string,
  ) {
    return ledger.addManualEntry(
      pat,
      {
        direction: cents > 0 ? LedgerDirection.credit : LedgerDirection.debit,
        amountCents: Math.abs(cents),
        effectiveDate: ago(daysAgo),
        reason,
        requestKey: randomUUID(),
        appliesToId,
      },
      admin,
    );
  }

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

  describe("overview", () => {
    it("is empty for a driver with no entries", async () => {
      expect(await ledger.overview(pat)).toEqual({
        balanceCents: 0,
        aging: {
          currentCents: 0,
          days7to13Cents: 0,
          days14to29Cents: 0,
          days30PlusCents: 0,
          pastDueCents: 0,
        },
        lastPayment: null,
        asOf: today,
      });
    });

    it("ages the unpaid charges, oldest paid first, and the buckets add up to what the driver owes", async () => {
      await add(-10_000, 40, "Old fee"); // 30+ days
      await add(-30_000, 20, "Repair"); // 14–29 days
      await add(-30_000, 8, "Another fee"); // 7–13 days
      await add(-30_000, 2, "Recent fee"); // current
      await add(15_000, 1, "Discount"); // pays the old fee (100) and 50 of the repair

      const { aging, balanceCents } = await ledger.overview(pat);
      expect(aging).toEqual({
        currentCents: 30_000,
        days7to13Cents: 30_000,
        days14to29Cents: 25_000,
        days30PlusCents: 0,
        pastDueCents: 55_000,
      });
      expect(
        aging.currentCents +
          aging.days7to13Cents +
          aging.days14to29Cents +
          aging.days30PlusCents,
      ).toBe(-balanceCents);
    });

    it("ignores a reversed charge and its reversal", async () => {
      const fee = await add(-4000, 40, "Entered by mistake");
      await add(-1000, 1, "Real fee");
      await ledger.reverse(pat, fee.id, "Mistake", admin);

      const { aging, balanceCents } = await ledger.overview(pat);
      expect(aging.days30PlusCents).toBe(0);
      expect(aging.currentCents).toBe(1000);
      expect(balanceCents).toBe(-1000);
    });

    it("shows no age for a driver who paid ahead", async () => {
      await add(-1000, 20, "Fee");
      await add(5000, 1, "Credit");
      const { aging, balanceCents } = await ledger.overview(pat);
      expect(balanceCents).toBe(4000);
      expect(aging.pastDueCents + aging.currentCents).toBe(0);
    });

    it("names the newest confirmed payment", async () => {
      const record = (days: number, cents: number) =>
        payments.recordManual(
          {
            driverId: pat,
            method: PaymentManualMethod.check,
            amountCents: cents,
            paidOn: ago(days),
            requestKey: randomUUID(),
          },
          admin,
        );
      await record(9, 1000);
      await record(3, 2000);
      await record(6, 3000);

      const { lastPayment } = await ledger.overview(pat);
      expect(lastPayment).toMatchObject({
        amountCents: 2000,
        source: PaymentSource.manual,
        manualMethod: PaymentManualMethod.check,
      });
    });

    it("refuses an unknown driver", async () => {
      await expect(ledger.overview(randomUUID())).rejects.toThrow(
        "Driver not found.",
      );
    });
  });

  describe("entry details", () => {
    it("shows a charge with its credits, one of them reversed, and what is left", async () => {
      const fee = await add(-5000, 6, "Flat tire");
      const first = await add(1000, 4, "Part waived", fee.id);
      const second = await add(1500, 3, "More waived", fee.id);
      await ledger.reverse(pat, second.id, "Undo", admin);

      const details = await ledger.entryDetails(pat, fee.id);
      expect(details.entry.ref).toBe(fee.ref);
      expect(
        details.appliedCredits.map((c) => [c.ref, c.amountCents, c.reversed]),
      ).toEqual([
        [first.ref, 1000, false],
        [second.ref, 1500, true],
      ]);
      expect(details.creditableCents).toBe(4000);
      expect(details.reversedBy).toBeNull();
      expect(details.appliesTo).toBeNull();
    });

    it("shows a credit's charge, and a reversal's original", async () => {
      const fee = await add(-5000, 6, "Flat tire");
      const credit = await add(1000, 4, "Part waived", fee.id);
      const reversal = await ledger.reverse(pat, credit.id, "Undo", admin);

      const creditDetails = await ledger.entryDetails(pat, credit.id);
      expect(creditDetails.appliesTo).toMatchObject({
        id: fee.id,
        ref: fee.ref,
        description: "Flat tire",
      });
      expect(creditDetails.reversedBy).toMatchObject({
        id: reversal.id,
        createdByEmail: "alice@admin.test",
      });
      expect(creditDetails.creditableCents).toBeNull();

      const reversalDetails = await ledger.entryDetails(pat, reversal.id);
      expect(reversalDetails.reversalOf).toMatchObject({ id: credit.id });
    });

    it("shows a payment, and lets only a manual, confirmed one be voided", async () => {
      const payment = await payments.recordManual(
        {
          driverId: pat,
          method: PaymentManualMethod.cash,
          amountCents: 7000,
          paidOn: today,
          reference: "R-1",
          requestKey: randomUUID(),
        },
        admin,
      );
      const entry = (await ledger.listPage(pat, { page: 1, limit: 10 }))
        .items[0];

      const details = await ledger.entryDetails(pat, entry.id);
      expect(details.payment).toMatchObject({
        id: payment.id,
        source: PaymentSource.manual,
        manualMethod: PaymentManualMethod.cash,
        transactionId: "R-1",
        status: "confirmed",
      });
      expect(details.canVoidPayment).toBe(true);
      expect(entry.canVoidPayment).toBe(true);
      expect(entry.description).toBe("Cash payment · ref R-1");

      await payments.voidManual(payment.id, "Bounced", admin);
      expect((await ledger.entryDetails(pat, entry.id)).canVoidPayment).toBe(
        false,
      );
    });

    it("does not show another driver's entry", async () => {
      const theirs = await ledger.addManualEntry(
        sam,
        {
          direction: LedgerDirection.debit,
          amountCents: 100,
          effectiveDate: today,
          reason: "x",
          requestKey: randomUUID(),
        },
        admin,
      );
      await expect(ledger.entryDetails(pat, theirs.id)).rejects.toThrow(
        "Ledger entry not found.",
      );
    });
  });
});
