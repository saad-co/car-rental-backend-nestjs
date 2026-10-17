import { ConflictException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { AliasType } from "../src/aliases/normalize-alias.js";
import {
  AliasSource,
  PaymentAlias,
} from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import {
  LedgerEntry,
  LedgerEntryKind,
} from "../src/ledger/ledger-entry.entity.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { MatchingService } from "../src/matching/matching.service.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import { openTestDatabase } from "./test-database.js";

describe("Driver ledger: payment credits (B77, D60, test database)", () => {
  let db: DataSource;
  let ledger: LedgerService;
  let payments: PaymentsService;
  let admin: string;
  let tim: string;
  let kim: string;
  let seq = 0;

  async function addPayment(values: Partial<Payment> = {}): Promise<string> {
    seq++;
    const result = await db.getRepository(Payment).insert({
      source: PaymentSource.email_venmo,
      externalId: `email-${seq}`,
      transactionId: null,
      amountCents: 5800,
      senderName: "Pat S",
      senderHandle: null,
      // 04:30 UTC on the 19th = 11:30 PM on the 18th in Chicago.
      occurredAt: new Date("2026-10-19T04:30:00Z"),
      extractionConfidence: 0.9,
      status: PaymentStatus.unmatched,
      ...values,
    });
    return (result.identifiers[0] as { id: string }).id;
  }

  const entriesOf = (paymentId: string) =>
    db.getRepository(LedgerEntry).find({
      where: { paymentId },
      order: { createdAt: "ASC", id: "ASC" },
    });

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
    [tim, kim] = (
      await db.getRepository(Driver).save([
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
      ])
    ).map((d) => d.id);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("a manual assign credits the driver once, on the payment's Chicago day", async () => {
    const id = await addPayment();
    await payments.assign(id, tim, admin);

    const [credit, ...rest] = await entriesOf(id);
    expect(rest).toHaveLength(0);
    expect(credit).toMatchObject({
      driverId: tim,
      kind: LedgerEntryKind.payment,
      direction: "credit",
      amountCents: 5800,
      effectiveDate: "2026-10-18",
      description: "Venmo payment from Pat S",
      idempotencyKey: `payment:${id}`,
      createdById: admin,
    });
    expect(await ledger.balanceCents(tim)).toBe(5800);

    // Assigning to the same driver again changes nothing.
    await payments.assign(id, tim, admin);
    expect(await entriesOf(id)).toHaveLength(1);
  });

  it("reassigning A → B → A moves the credit by reversals; each driver ends right", async () => {
    const id = await addPayment();
    await payments.assign(id, tim, admin);
    await payments.assign(id, kim, admin);
    expect(await ledger.balanceCents(tim)).toBe(0);
    expect(await ledger.balanceCents(kim)).toBe(5800);

    await payments.assign(id, tim, admin);
    expect(await ledger.balanceCents(tim)).toBe(5800);
    expect(await ledger.balanceCents(kim)).toBe(0);

    // A reversal and the new credit share one transaction, hence one `created_at`: compare as sets, not in order.
    const rows = await entriesOf(id);
    const summary = rows
      .map((r) => `${r.kind}:${r.driverId === tim ? "tim" : "kim"}`)
      .sort();
    expect(summary).toEqual([
      "payment:kim",
      "payment:tim",
      "payment:tim",
      "reversal:kim",
      "reversal:tim",
    ]);
    expect(
      rows
        .filter((r) => r.kind === LedgerEntryKind.reversal)
        .map((r) => r.description),
    ).toEqual([
      "Payment moved to another driver",
      "Payment moved to another driver",
    ]);
  });

  it("a payment credit cannot be reversed from the ledger (only through the payment)", async () => {
    const id = await addPayment();
    await payments.assign(id, tim, admin);
    const [credit] = await entriesOf(id);
    expect((await ledger.findDto(credit.id)).canReverse).toBe(false);
    await expect(
      ledger.reverse(tim, credit.id, "Wrong", admin),
    ).rejects.toThrow(ConflictException);
  });

  it("matching credits the payment it assigns, once, with no admin", async () => {
    await db.getRepository(PaymentAlias).insert({
      driverId: kim,
      type: AliasType.cashapp,
      value: "College And Beyond",
      valueNormalized: "college and beyond",
      source: AliasSource.legacy,
    });
    const id = await addPayment({
      source: PaymentSource.email_cashapp,
      senderName: "COLLEGE AND BEYOND",
    });
    const matching = new MatchingService(db, ledger, null);
    expect(await matching.matchPending()).toMatchObject({ assigned: 1 });
    await matching.matchPending();

    const rows = await entriesOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      driverId: kim,
      createdById: null,
      description: "Cash App payment from COLLEGE AND BEYOND",
    });
  });

  it("backfill credits payments confirmed before the ledger existed; dry run writes nothing; twice = once", async () => {
    const old = await addPayment({
      status: PaymentStatus.confirmed,
      driverId: tim,
      matchMethod: MatchMethod.alias,
      matchConfidence: 1,
    });
    await addPayment(); // unmatched: never credited
    const credited = await addPayment();
    await payments.assign(credited, kim, admin); // already credited

    expect(await ledger.backfillPaymentCredits(false)).toEqual({
      missing: 1,
      credited: 0,
    });
    expect(await entriesOf(old)).toHaveLength(0);

    expect(await ledger.backfillPaymentCredits(true)).toEqual({
      missing: 1,
      credited: 1,
    });
    expect(await ledger.backfillPaymentCredits(true)).toEqual({
      missing: 0,
      credited: 0,
    });
    expect(await ledger.balanceCents(tim)).toBe(5800);
    expect(await ledger.balanceCents(kim)).toBe(5800);
  });
});
