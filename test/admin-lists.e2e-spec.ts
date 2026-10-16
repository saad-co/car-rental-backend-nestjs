import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { Driver } from "../src/drivers/driver.entity.js";
import { ListInboundEmailsQueryDto } from "../src/email-intake/dto/list-inbound-emails-query.dto.js";
import {
  InboundEmail,
  InboundEmailStatus,
} from "../src/email-intake/inbound-email.entity.js";
import { InboundEmailsService } from "../src/email-intake/inbound-emails.service.js";
import { ListPaymentsQueryDto } from "../src/payments/dto/list-payments-query.dto.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import { openTestDatabase } from "./test-database.js";

/** A query DTO as the ValidationPipe builds it from the query string (text in, defaults applied). */
function query<T extends object>(
  dto: new () => T,
  values: Record<string, string>,
): T {
  const instance = plainToInstance(dto, values);
  const errors = validateSync(instance);
  if (errors.length > 0) throw new Error(errors.map(String).join("\n"));
  return instance;
}

describe("Admin lists: payments and the email log (test database)", () => {
  let db: DataSource;
  let payments: PaymentsService;
  let emails: InboundEmailsService;

  /** Stores one email (as the intake would) and returns its id. */
  async function addEmail(
    uid: number,
    status: InboundEmailStatus,
    provider: InboundEmail["provider"],
  ): Promise<string> {
    const result = await db.getRepository(InboundEmail).insert({
      mailbox: "gonzobilling@gmail.com",
      imapUidValidity: 1,
      imapUid: uid,
      gmailMessageId: `gm-${uid}`,
      messageId: null,
      fromAddress: "venmo@venmo.com",
      subject: `Email ${uid}`,
      receivedAt: new Date(Date.UTC(2026, 9, 10, 12, uid % 60)),
      authDkimPass: status !== InboundEmailStatus.rejected_unverified,
      authDkimDomain: null,
      provider,
      status,
      statusReason:
        status === InboundEmailStatus.processed ||
        status === InboundEmailStatus.not_payment
          ? null
          : "test reason",
      bodyText: "private body",
    });
    return (result.identifiers[0] as { id: string }).id;
  }

  async function addPayment(
    emailId: string,
    source: PaymentSource,
    occurredAt: Date,
  ): Promise<string> {
    const result = await db.getRepository(Payment).insert({
      source,
      externalId: emailId,
      transactionId: null,
      amountCents: 5900,
      senderName: "Pat Example",
      senderHandle: null,
      occurredAt,
      extractionConfidence: 0.9,
      status: PaymentStatus.unmatched,
    });
    return (result.identifiers[0] as { id: string }).id;
  }

  beforeAll(async () => {
    db = await openTestDatabase();
    payments = new PaymentsService(db);
    emails = new InboundEmailsService(
      db.getRepository(InboundEmail),
      db.getRepository(Payment),
    );
  });

  beforeEach(async () => {
    await db.query("TRUNCATE payments, inbound_emails, drivers CASCADE");
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("lists payments most recent first, filtered and paginated", async () => {
    const e1 = await addEmail(1, InboundEmailStatus.processed, "venmo");
    const e2 = await addEmail(2, InboundEmailStatus.processed, "zelle_chase");
    const e3 = await addEmail(3, InboundEmailStatus.processed, "venmo");
    const older = await addPayment(
      e1,
      PaymentSource.email_venmo,
      new Date("2026-10-09T10:00:00Z"),
    );
    const zelle = await addPayment(
      e2,
      PaymentSource.email_zelle,
      new Date("2026-10-10T10:00:00Z"),
    );
    const newest = await addPayment(
      e3,
      PaymentSource.email_venmo,
      new Date("2026-10-11T10:00:00Z"),
    );

    const all = await payments.list(query(ListPaymentsQueryDto, {}));
    expect(all.total).toBe(3);
    expect(all.items.map((p) => p.id)).toEqual([newest, zelle, older]);

    const venmo = await payments.list(
      query(ListPaymentsQueryDto, {
        source: "email_venmo",
        status: "unmatched",
      }),
    );
    expect(venmo.items.map((p) => p.id)).toEqual([newest, older]);
    expect(venmo.total).toBe(2);

    const page2 = await payments.list(
      query(ListPaymentsQueryDto, { page: "2", limit: "2" }),
    );
    expect(page2).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(page2.items.map((p) => p.id)).toEqual([older]);
  });

  it("lists the email log newest first, with the payment each email created and no body", async () => {
    const paid = await addEmail(10, InboundEmailStatus.processed, "venmo");
    const failed = await addEmail(
      11,
      InboundEmailStatus.extraction_failed,
      "venmo",
    );
    const forged = await addEmail(
      12,
      InboundEmailStatus.rejected_unverified,
      "zelle_chase",
    );
    const paymentId = await addPayment(
      paid,
      PaymentSource.email_venmo,
      new Date(),
    );

    const all = await emails.list(query(ListInboundEmailsQueryDto, {}));
    expect(all.items.map((e) => e.id)).toEqual([forged, failed, paid]);
    expect(all.items.find((e) => e.id === paid)?.paymentId).toBe(paymentId);
    expect(all.items.find((e) => e.id === failed)).toMatchObject({
      paymentId: null,
      statusReason: "test reason",
    });
    expect(all.items[0]).not.toHaveProperty("bodyText");

    const venmoFailures = await emails.list(
      query(ListInboundEmailsQueryDto, {
        provider: "venmo",
        status: "extraction_failed",
      }),
    );
    expect(venmoFailures.items.map((e) => e.id)).toEqual([failed]);
  });

  it("searches payments by payer name, payer handle and the assigned driver's name (B75)", async () => {
    const [sutton] = await db.getRepository(Driver).save([
      {
        firstName: "Tim",
        lastName: "Sutton",
        email: "tim@example.com",
        phone: "+13125550101",
      },
    ]);
    const e1 = await addEmail(1, InboundEmailStatus.processed, "venmo");
    const e2 = await addEmail(2, InboundEmailStatus.processed, "venmo");
    const e3 = await addEmail(3, InboundEmailStatus.processed, "venmo");
    const byName = await addPayment(
      e1,
      PaymentSource.email_venmo,
      new Date("2026-10-09T10:00:00Z"),
    ); // payer "Pat Example"
    const byHandle = await addPayment(
      e2,
      PaymentSource.email_venmo,
      new Date("2026-10-10T10:00:00Z"),
    );
    await db
      .getRepository(Payment)
      .update(byHandle, { senderName: "Someone", senderHandle: "@pat-x" });
    const byDriver = await addPayment(
      e3,
      PaymentSource.email_venmo,
      new Date("2026-10-11T10:00:00Z"),
    );
    await db.getRepository(Payment).update(byDriver, {
      senderName: "Logistics LLC",
      driverId: sutton.id,
      status: PaymentStatus.confirmed,
      matchMethod: MatchMethod.manual,
    });

    const ids = async (values: Record<string, string>) =>
      (await payments.list(query(ListPaymentsQueryDto, values))).items.map(
        (p) => p.id,
      );
    expect(await ids({ search: "PAT" })).toEqual([byHandle, byName]);
    expect(await ids({ search: "tim sutton" })).toEqual([byDriver]);
    expect(await ids({ search: "pat", match: "assigned" })).toEqual([]);
    // The driver comes with the payment, as before the search was added.
    expect(
      (await payments.list(query(ListPaymentsQueryDto, { search: "sutton" })))
        .items[0].driver,
    ).toMatchObject({ id: sutton.id });
  });

  it("searches the email log by subject and sender address (B75)", async () => {
    const venmo = await addEmail(20, InboundEmailStatus.processed, "venmo");
    const chase = await addEmail(
      21,
      InboundEmailStatus.processed,
      "zelle_chase",
    );
    await db
      .getRepository(InboundEmail)
      .update(chase, { fromAddress: "no.reply.alerts@chase.com" });

    const ids = async (values: Record<string, string>) =>
      (await emails.list(query(ListInboundEmailsQueryDto, values))).items.map(
        (e) => e.id,
      );
    expect(await ids({ search: "email 20" })).toEqual([venmo]);
    expect(await ids({ search: "CHASE.COM" })).toEqual([chase]);
    expect(await ids({ search: "email", provider: "zelle_chase" })).toEqual([
      chase,
    ]);
  });

  it("rejects unknown filter values (the ValidationPipe answers 400)", () => {
    expect(() =>
      query(ListInboundEmailsQueryDto, { provider: "paypal" }),
    ).toThrow();
    expect(() => query(ListPaymentsQueryDto, { status: "paid" })).toThrow();
    expect(() => query(ListPaymentsQueryDto, { limit: "500" })).toThrow();
  });
});
