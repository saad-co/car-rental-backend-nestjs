import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { addDays, chicagoDate } from "../src/common/chicago-date.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { LedgerEntry } from "../src/ledger/ledger-entry.entity.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import {
  Payment,
  PaymentManualMethod,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import { RecordPaymentDto } from "../src/payments/dto/record-payment.dto.js";
import { openTestDatabase } from "./test-database.js";

describe("Payments recorded by hand (B79, test database)", () => {
  let db: DataSource;
  let ledger: LedgerService;
  let payments: PaymentsService;
  let admin: string;
  let pat: string;
  let sam: string;

  const today = chicagoDate(new Date());
  const ago = (days: number) => addDays(today, -days);

  const record = (values: Partial<RecordPaymentDto> = {}) =>
    payments.recordManual(
      {
        driverId: pat,
        method: PaymentManualMethod.cash,
        amountCents: 30_000,
        paidOn: today,
        requestKey: randomUUID(),
        ...values,
      },
      admin,
    );

  const credits = () =>
    db.getRepository(LedgerEntry).find({ order: { createdAt: "ASC" } });

  /** The body of a conflict, which carries a code for the duplicate warning. */
  async function conflictBody(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ConflictException) {
        return error.getResponse() as Record<string, unknown>;
      }
      throw error;
    }
    throw new Error("expected a conflict");
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

  it("records a confirmed manual payment and credits the driver's ledger", async () => {
    const payment = await record({ reference: "Receipt 17" });
    expect(payment).toMatchObject({
      source: PaymentSource.manual,
      manualMethod: PaymentManualMethod.cash,
      status: PaymentStatus.confirmed,
      amountCents: 30_000,
      transactionId: "Receipt 17",
      matchMethod: "manual",
      driver: { id: pat, firstName: "Pat", lastName: "Driver" },
    });

    const entries = await credits();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      driverId: pat,
      direction: "credit",
      amountCents: 30_000,
      kind: "payment",
      paymentId: payment.id,
      description: "Cash payment · ref Receipt 17",
      effectiveDate: today,
      createdById: admin,
    });
    expect(await ledger.balanceCents(pat)).toBe(30_000);

    // It shows in the Payments list like any other payment.
    const page = await payments.list({ page: 1, limit: 10 } as never);
    expect(page.items.map((p) => p.id)).toEqual([payment.id]);
  });

  it("puts a payment from an earlier day on that day, in Chicago", async () => {
    const payment = await record({ paidOn: ago(5) });
    expect(chicagoDate(payment.occurredAt)).toBe(ago(5));
    expect((await credits())[0].effectiveDate).toBe(ago(5));
  });

  describe("sending the same request twice", () => {
    it("returns the payment already recorded and credits only once", async () => {
      const requestKey = randomUUID();
      const first = await record({ requestKey });
      const again = await record({ requestKey });
      expect(again.id).toBe(first.id);
      expect(await db.getRepository(Payment).count()).toBe(1);
      expect(await credits()).toHaveLength(1);
    });

    it("refuses the same key for a different payment", async () => {
      const requestKey = randomUUID();
      await record({ requestKey });
      await expect(record({ requestKey, amountCents: 31_000 })).rejects.toThrow(
        "already used for a different payment",
      );
    });

    it("answers two simultaneous requests with one payment", async () => {
      const requestKey = randomUUID();
      const [one, two] = await Promise.all([
        record({ requestKey }),
        record({ requestKey }),
      ]);
      expect(one.id).toBe(two.id);
      expect(await credits()).toHaveLength(1);
    });
  });

  it("refuses a reference that was already recorded", async () => {
    await record({ reference: "Check 1043" });
    await expect(
      record({ reference: "Check 1043", amountCents: 12_300 }),
    ).rejects.toThrow(
      "A manual payment with reference Check 1043 was already recorded.",
    );
    expect(await credits()).toHaveLength(1);
  });

  describe("validation", () => {
    it("refuses a future date and a date more than 90 days back", async () => {
      await expect(record({ paidOn: addDays(today, 1) })).rejects.toThrow(
        "cannot be in the future",
      );
      await expect(record({ paidOn: ago(91) })).rejects.toThrow(
        "at most 90 days back",
      );
      await expect(record({ paidOn: "2026-02-30" })).rejects.toThrow(
        "not a real calendar day",
      );
      expect(await record({ paidOn: ago(90) })).toBeDefined();
    });

    it("refuses an unknown driver", async () => {
      await expect(record({ driverId: randomUUID() })).rejects.toThrow(
        "Driver not found.",
      );
    });
  });

  describe("possible duplicate", () => {
    it("warns about a payment of the same amount within three days, and records it when confirmed", async () => {
      // An email payment already credited: Zelle, $300, two days ago.
      await db.getRepository(Payment).insert({
        source: PaymentSource.email_zelle,
        externalId: "email-1",
        transactionId: null,
        amountCents: 30_000,
        senderName: "Pat Driver",
        senderHandle: null,
        occurredAt: new Date(`${ago(2)}T18:00:00Z`),
        extractionConfidence: 0.9,
        status: PaymentStatus.confirmed,
        driverId: pat,
        matchMethod: "alias" as never,
      });

      const body = await conflictBody(
        record({ method: PaymentManualMethod.zelle }),
      );
      expect(body).toMatchObject({
        code: "possible_duplicate",
        duplicate: { source: "email_zelle", amountCents: 30_000 },
      });
      expect(await db.getRepository(Payment).count()).toBe(1);

      const requestKey = randomUUID();
      const recorded = await record({
        method: PaymentManualMethod.zelle,
        confirmDuplicate: true,
        requestKey,
      });
      expect(recorded.status).toBe(PaymentStatus.confirmed);
      expect(await db.getRepository(Payment).count()).toBe(2);
    });

    it("does not warn for another amount, another driver, or a payment four days away", async () => {
      await record({ amountCents: 30_000, paidOn: ago(4) });
      expect(await record({ amountCents: 30_001 })).toBeDefined();
      expect(await record({ driverId: sam })).toBeDefined();
      expect(await record({ paidOn: today })).toBeDefined(); // 4 days from the first
    });

    it("warns about the same payment recorded twice in a row", async () => {
      await record();
      const body = await conflictBody(record());
      expect(body.code).toBe("possible_duplicate");
    });
  });

  describe("voiding", () => {
    it("rejects the payment and reverses its credit, leaving the history", async () => {
      const payment = await record({
        method: PaymentManualMethod.check,
        reference: "Check 7",
      });
      const voided = await payments.voidManual(
        payment.id,
        "Check bounced",
        admin,
      );

      expect(voided.status).toBe(PaymentStatus.rejected);
      expect(voided.matchExplanation).toBe("Voided by an admin: Check bounced");
      expect(await ledger.balanceCents(pat)).toBe(0);

      const entries = await credits();
      expect(entries.map((e) => [e.kind, e.direction, e.description])).toEqual([
        ["payment", "credit", "Check payment · ref Check 7"],
        ["reversal", "debit", "Payment voided: Check bounced"],
      ]);
    });

    it("refuses to void twice, and an email payment", async () => {
      const payment = await record();
      await payments.voidManual(payment.id, "Mistake", admin);
      await expect(
        payments.voidManual(payment.id, "Again", admin),
      ).rejects.toThrow("already voided");

      const email = (
        await db.getRepository(Payment).insert({
          source: PaymentSource.email_venmo,
          externalId: "email-2",
          transactionId: null,
          amountCents: 5800,
          senderName: "Pat S",
          senderHandle: null,
          occurredAt: new Date(),
          extractionConfidence: 0.9,
          status: PaymentStatus.unmatched,
        })
      ).identifiers[0] as { id: string };
      await expect(payments.voidManual(email.id, "No", admin)).rejects.toThrow(
        "Only a payment recorded by hand can be voided",
      );
    });

    it("refuses an unknown payment", async () => {
      await expect(
        payments.voidManual(randomUUID(), "x", admin),
      ).rejects.toThrow("Payment not found.");
    });
  });
  describe("description and internal note", () => {
    it("uses the description for the ledger line and copies the note to the credit", async () => {
      const payment = await record({
        description: "Cash handed over at the office",
        internalNote: "Counted twice",
      });
      expect(payment).toMatchObject({
        description: "Cash handed over at the office",
        internalNote: "Counted twice",
      });
      const [credit] = await credits();
      expect(credit).toMatchObject({
        description: "Cash handed over at the office",
        internalNote: "Counted twice",
      });
    });

    it("keeps the automatic text and no note when none are given", async () => {
      const payment = await record({ reference: "R-9" });
      expect(payment).toMatchObject({ description: null, internalNote: null });
      const [credit] = await credits();
      expect(credit.description).toBe("Cash payment · ref R-9");
      expect(credit.internalNote).toBeNull();
    });

    it("answers the same request with the same payment, and refuses the key for another description", async () => {
      const requestKey = randomUUID();
      const first = await record({
        requestKey,
        description: "A",
        internalNote: "n",
      });
      const again = await record({
        requestKey,
        description: "A",
        internalNote: "n",
      });
      expect(again.id).toBe(first.id);
      await expect(
        record({ requestKey, description: "B", internalNote: "n" }),
      ).rejects.toThrow("already used for a different payment");
    });

    it("leaves the reversal of a voided payment without the note", async () => {
      const payment = await record({ internalNote: "Check from the owner" });
      await payments.voidManual(payment.id, "Bounced", admin);
      const entries = await credits();
      expect(entries.map((e) => e.internalNote)).toEqual([
        "Check from the owner",
        null,
      ]);
    });
  });
});
