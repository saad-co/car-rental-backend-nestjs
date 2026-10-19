import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import type { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { Application } from "../src/applications/application.entity.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import { ListApplicationsQueryDto } from "../src/applications/dto/list-applications-query.dto.js";
import { DateRangeQueryDto } from "../src/common/dto/date-range-query.dto.js";
import { PaymentAlias } from "../src/aliases/payment-alias.entity.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { DriversService } from "../src/drivers/drivers.service.js";
import { ListDriversQueryDto } from "../src/drivers/dto/list-drivers-query.dto.js";
import { ListInboundEmailsQueryDto } from "../src/email-intake/dto/list-inbound-emails-query.dto.js";
import {
  InboundEmail,
  InboundEmailStatus,
} from "../src/email-intake/inbound-email.entity.js";
import { InboundEmailsService } from "../src/email-intake/inbound-emails.service.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import type { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import { ListPaymentsQueryDto } from "../src/payments/dto/list-payments-query.dto.js";
import {
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import type { SmsService } from "../src/sms/sms.service.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase } from "./test-database.js";

/** A query DTO as the ValidationPipe builds it from the query string. */
function query<T extends object>(
  dto: new () => T,
  values: Record<string, string>,
): T {
  const instance = plainToInstance(dto, values);
  const errors = validateSync(instance);
  if (errors.length > 0) throw new Error(errors.map(String).join("\n"));
  return instance;
}

/**
 * Moments around Chicago midnights. In October Chicago is on CDT (UTC-5), in December on CST (UTC-6), so the same
 * Chicago day starts at a different UTC hour.
 */
const OCT_15_LATE = "2026-10-16T04:59:00Z"; // Oct 15, 23:59 in Chicago
const OCT_16_START = "2026-10-16T05:00:00Z"; // Oct 16, 00:00 in Chicago
const DEC_15_LATE = "2026-12-16T05:59:00Z"; // Dec 15, 23:59 in Chicago
const DEC_16_START = "2026-12-16T06:00:00Z"; // Dec 16, 00:00 in Chicago

describe("Date range on the lists (B82, test database)", () => {
  let db: DataSource;
  let applications: ApplicationsService;
  let drivers: DriversService;
  let payments: PaymentsService;
  let emails: InboundEmailsService;

  const appNames = async (values: Record<string, string>) =>
    (await applications.list(query(ListApplicationsQueryDto, values))).items
      .map((a) => a.firstName)
      .sort();

  async function addApplication(firstName: string, createdAt: string) {
    await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, created_at)
       VALUES ($1, $2, 'Test', $3, '3125550000', '{}', $4)`,
      [
        `req-${firstName}`,
        firstName,
        `${firstName.toLowerCase()}@test.dev`,
        createdAt,
      ],
    );
  }

  beforeAll(async () => {
    db = await openTestDatabase();
    applications = new ApplicationsService(
      db.getRepository(Application),
      db,
      new PasswordService(),
      {} as SmsService,
      {} as ApplicationAlertService,
      { getOrThrow: () => "https://app.test" } as unknown as ConfigService,
      null,
      {} as MessageTemplatesService,
    );
    drivers = new DriversService(
      db.getRepository(Driver),
      db.getRepository(PaymentAlias),
      db.getRepository(Payment),
    );
    payments = new PaymentsService(db, new LedgerService(db));
    emails = new InboundEmailsService(
      db.getRepository(InboundEmail),
      db.getRepository(Payment),
    );
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE applications, payments, inbound_emails, payment_aliases, drivers, users CASCADE",
    );
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("applications (the received day)", () => {
    beforeEach(async () => {
      await addApplication("Before", OCT_15_LATE);
      await addApplication("After", OCT_16_START);
      await addApplication("WinterBefore", DEC_15_LATE);
      await addApplication("WinterAfter", DEC_16_START);
    });

    it("counts days in Chicago, not UTC: 04:59 UTC is still the 15th, 05:00 UTC is the 16th (CDT)", async () => {
      expect(await appNames({ from: "2026-10-15", to: "2026-10-15" })).toEqual([
        "Before",
      ]);
      expect(await appNames({ from: "2026-10-16", to: "2026-10-16" })).toEqual([
        "After",
      ]);
    });

    it("handles winter time too: the day starts at 06:00 UTC (CST)", async () => {
      expect(await appNames({ from: "2026-12-15", to: "2026-12-15" })).toEqual([
        "WinterBefore",
      ]);
      expect(await appNames({ from: "2026-12-16", to: "2026-12-16" })).toEqual([
        "WinterAfter",
      ]);
    });

    it("the last day is included whole; either end can be left open", async () => {
      expect(await appNames({ to: "2026-10-15" })).toEqual(["Before"]);
      expect(await appNames({ from: "2026-12-15" })).toEqual([
        "WinterAfter",
        "WinterBefore",
      ]);
      expect(await appNames({ from: "2026-10-15", to: "2026-12-15" })).toEqual([
        "After",
        "Before",
        "WinterBefore",
      ]);
      expect(await appNames({})).toHaveLength(4);
    });

    it("works together with the search, and the total counts only matching rows", async () => {
      const page = await applications.list(
        query(ListApplicationsQueryDto, {
          from: "2026-10-01",
          to: "2026-10-31",
          search: "after",
        }),
      );
      expect(page.items.map((a) => a.firstName)).toEqual(["After"]);
      expect(page.total).toBe(1);
    });

    it("a blank from or to means no limit", async () => {
      expect(await appNames({ from: "", to: "  " })).toHaveLength(4);
    });

    it("from after to is refused with a clear message", async () => {
      await expect(
        applications.list(
          query(ListApplicationsQueryDto, {
            from: "2026-10-16",
            to: "2026-10-15",
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it("drivers: filtered by the day they were created", async () => {
    await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone, created_at) VALUES
         ('Early', 'D', 'early@test.dev', '+13125550101', $1),
         ('Late', 'D', 'late@test.dev', '+13125550102', $2)`,
      [OCT_15_LATE, OCT_16_START],
    );
    const names = async (values: Record<string, string>) =>
      (await drivers.list(query(ListDriversQueryDto, values))).items.map(
        (d) => d.firstName,
      );
    expect(await names({ from: "2026-10-16" })).toEqual(["Late"]);
    expect(await names({ to: "2026-10-15" })).toEqual(["Early"]);
    expect(await names({ from: "2026-10-15", to: "2026-10-16" })).toHaveLength(
      2,
    );
  });

  it("payments: filtered by the day they were paid", async () => {
    const insert = (occurredAt: string, externalId: string) =>
      db.getRepository(Payment).insert({
        source: PaymentSource.manual,
        externalId,
        transactionId: null,
        amountCents: 5900,
        senderName: externalId,
        senderHandle: null,
        occurredAt: new Date(occurredAt),
        extractionConfidence: null,
        status: PaymentStatus.unmatched,
      });
    await insert(OCT_15_LATE, "early");
    await insert(OCT_16_START, "late");
    const senders = async (values: Record<string, string>) =>
      (await payments.list(query(ListPaymentsQueryDto, values))).items.map(
        (p) => p.senderName,
      );
    expect(await senders({ from: "2026-10-16", to: "2026-10-16" })).toEqual([
      "late",
    ]);
    expect(await senders({ to: "2026-10-15" })).toEqual(["early"]);
  });

  it("email log: filtered by the day the mail arrived", async () => {
    const insert = (uid: number, receivedAt: string) =>
      db.getRepository(InboundEmail).insert({
        mailbox: "gonzobilling@gmail.com",
        imapUidValidity: 1,
        imapUid: uid,
        gmailMessageId: `gm-${uid}`,
        messageId: null,
        fromAddress: "venmo@venmo.com",
        subject: `Email ${uid}`,
        receivedAt: new Date(receivedAt),
        authDkimPass: true,
        authDkimDomain: null,
        provider: "venmo",
        status: InboundEmailStatus.processed,
        statusReason: null,
        bodyText: "body",
      });
    await insert(1, OCT_15_LATE);
    await insert(2, OCT_16_START);
    const subjects = async (values: Record<string, string>) =>
      (await emails.list(query(ListInboundEmailsQueryDto, values))).items.map(
        (e) => e.subject,
      );
    expect(await subjects({ from: "2026-10-16" })).toEqual(["Email 2"]);
    expect(await subjects({ to: "2026-10-15" })).toEqual(["Email 1"]);
  });

  it("refuses dates that are not real YYYY-MM-DD days (the ValidationPipe answers 400)", () => {
    for (const bad of [
      "2026-02-30",
      "2026-10-1",
      "10/15/2026",
      "2026-10-15T10:00:00Z",
      "yesterday",
    ]) {
      const errors = validateSync(
        plainToInstance(DateRangeQueryDto, { from: bad }),
      );
      expect(errors, bad).not.toHaveLength(0);
    }
    expect(
      validateSync(
        plainToInstance(DateRangeQueryDto, {
          from: "2026-02-28",
          to: "2026-03-01",
        }),
      ),
    ).toHaveLength(0);
  });
});
