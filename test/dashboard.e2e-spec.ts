import "reflect-metadata";
import type { DataSource } from "typeorm";
import { DashboardService } from "../src/dashboard/dashboard.service.js";
import {
  Driver,
  DriverLeftReason,
  DriverStatus,
} from "../src/drivers/driver.entity.js";
import {
  InboundEmail,
  InboundEmailStatus,
} from "../src/email-intake/inbound-email.entity.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import type { SmsService } from "../src/sms/sms.service.js";
import { openTestDatabase } from "./test-database.js";

/**
 * The dashboard's numbers (D88), worked out by hand. The clock is fixed: Thursday 2026-11-05, 2:30 PM in Chicago
 * (20:30 UTC; daylight saving ended on 2026-11-01, so Chicago is UTC-6, and a Chicago day starts at 06:00 UTC).
 */
const NOW = new Date("2026-11-05T20:30:00Z");
const TODAY = "2026-11-05";

const sms = {
  status: () => ({
    mode: "dry_run",
    quoConfigured: false,
    filesConfigured: false,
  }),
} as unknown as SmsService;

describe("Dashboard figures (D88, test database)", () => {
  let db: DataSource;
  let dashboard: DashboardService;
  let externalNo = 0;
  let uid = 0;
  let requestNo = 0;
  let admin: string;

  beforeAll(async () => {
    db = await openTestDatabase();
    dashboard = new DashboardService(db, sms);
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE ledger_entries, payments, payment_aliases, contracts, applications, inbound_emails, email_intake_status, sms_messages, drivers, users CASCADE",
    );
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** A driver. `active` (the default) has the three onboarding steps done, as the database requires. */
  async function driver(
    name: string,
    overrides: Partial<Driver> = {},
  ): Promise<string> {
    const status = overrides.status ?? DriverStatus.active;
    const done = new Date("2026-09-01T12:00:00Z");
    const saved = await db.getRepository(Driver).save({
      firstName: name,
      lastName: "Driver",
      email: `${name.toLowerCase()}@test.dev`,
      phone: "+13125550101",
      status,
      ...(status === DriverStatus.onboarding
        ? {}
        : {
            contractSignedAt: done,
            depositPaidAt: done,
            vehicleAssignedAt: done,
          }),
      // `left_reason` and `left_at` come together (drivers_left_shape).
      ...(overrides.leftReason ? { leftAt: done } : {}),
      ...overrides,
    });
    return saved.id;
  }

  async function contract(
    driverId: string,
    schedule: "daily" | "weekly",
    rateCents: number,
    startDate: string,
    signed = true,
  ) {
    await db.query(
      // A sent contract has `sent_at`, a firma request id and `sent_values` together; a draft has none (contracts_sent_shape).
      `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date, term_months, security_deposit_cents,
                              status, signed_at, sent_at, firma_signing_request_id, sent_values)
       VALUES ($1, $2, $3, $4, 18, 0, $5, $6, $7, $8, $9)`,
      [
        driverId,
        schedule,
        rateCents,
        startDate,
        signed ? "signed" : "draft",
        signed ? `${startDate}T15:00:00Z` : null,
        signed ? `${startDate}T12:00:00Z` : null,
        signed ? `firma-${++externalNo}` : null,
        signed ? "{}" : null,
      ],
    );
  }

  /** A ledger entry; `debit` and `credit` are in cents. Returns the entry id. */
  async function entry(
    driverId: string,
    direction: "debit" | "credit",
    cents: number,
    // A debit is a system rent charge; a credit is a manual adjustment, which must name an admin (ledger_entries_adjustment_shape).
    kind = direction === "debit" ? "rent" : "adjustment",
    reversalOfId: string | null = null,
  ): Promise<string> {
    const [row] = (await db.query(
      `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, description, effective_date, idempotency_key, reversal_of_id, created_by_id)
       VALUES ($1, $2, $3, $4, 'test', $5, $6, $7, $8) RETURNING id`,
      [
        driverId,
        direction,
        cents,
        kind,
        TODAY,
        `test:${++externalNo}`,
        reversalOfId,
        admin,
      ],
    )) as { id: string }[];
    return row.id;
  }

  async function payment(
    cents: number,
    occurredAt: string,
    source: PaymentSource,
    status: PaymentStatus,
    driverId: string | null,
    attempted = false,
  ) {
    await db.getRepository(Payment).insert({
      source,
      externalId: `ext-${++externalNo}`,
      transactionId: null,
      amountCents: cents,
      senderName: "Pat Example",
      senderHandle: null,
      occurredAt: new Date(occurredAt),
      extractionConfidence: null,
      status,
      driverId,
      // A payment with a driver has a match method, one without has none (payments_driver_has_method).
      matchMethod: driverId ? MatchMethod.manual : null,
      matchAttemptedAt: attempted ? new Date(occurredAt) : null,
    });
  }

  async function application(status: string, archived = false) {
    await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload, status, archived_at)
       VALUES ($1, 'Ann', 'Applicant', $2, '3125550101', '{}', $3, $4)`,
      [
        `req-${++requestNo}`,
        `ann${requestNo}@test.dev`,
        status,
        archived ? NOW : null,
      ],
    );
  }

  async function email(status: InboundEmailStatus, hoursAgo: number) {
    const at = new Date(NOW.getTime() - hoursAgo * 3_600_000);
    await db.getRepository(InboundEmail).insert({
      mailbox: "gonzobilling@gmail.com",
      imapUidValidity: 1,
      imapUid: ++uid,
      gmailMessageId: `gm-${uid}`,
      messageId: null,
      fromAddress: "venmo@venmo.com",
      subject: `Email ${uid}`,
      receivedAt: at,
      authDkimPass: status !== InboundEmailStatus.rejected_unverified,
      authDkimDomain: null,
      provider: "venmo",
      status,
      statusReason:
        status === InboundEmailStatus.processed ||
        status === InboundEmailStatus.not_payment
          ? null
          : "test reason",
      createdAt: at,
    });
  }

  describe("payments, trend and sources", () => {
    beforeEach(async () => {
      const dana = await driver("Dana");
      const { zelle, cashapp, manual } = {
        zelle: PaymentSource.email_zelle,
        cashapp: PaymentSource.email_cashapp,
        manual: PaymentSource.manual,
      };
      const ok = PaymentStatus.confirmed;
      // Today starts at 06:00 UTC; one minute before is still yesterday in Chicago.
      await payment(10_000, "2026-11-05T06:00:00Z", zelle, ok, dana);
      await payment(5_000, "2026-11-05T05:59:00Z", cashapp, ok, dana);
      // Sunday: inside the 7 days, but before this week (Monday 2026-11-02).
      await payment(2_500, "2026-11-01T20:00:00Z", manual, ok, dana);
      // 2026-10-10: inside the 30 days, outside the 7.
      await payment(4_000, "2026-10-10T12:00:00Z", manual, ok, dana);
      await payment(9_000, "2026-09-01T12:00:00Z", manual, ok, dana);
      // A rejected payment never counts.
      await payment(
        99_999,
        "2026-11-05T12:00:00Z",
        manual,
        PaymentStatus.rejected,
        null,
      );
      // The queue: one the matcher tried (a person must assign), one it has not looked at.
      await payment(
        3_000,
        "2026-11-04T12:00:00Z",
        zelle,
        PaymentStatus.unmatched,
        null,
        true,
      );
      await payment(
        1_000,
        "2026-11-04T13:00:00Z",
        cashapp,
        PaymentStatus.unmatched,
        null,
      );
    });

    it("adds up the confirmed money, the queue and the windows (Chicago days)", async () => {
      const { payments, today } = await dashboard.get(NOW);
      expect(today).toBe(TODAY);
      expect(payments).toEqual({
        processedCents: 34_500, // confirmed 30_500 + the queue 4_000; the rejected 99_999 is left out
        processedCount: 7,
        grossCents: 30_500,
        grossCount: 5,
        matchedPercent: 71, // 5 confirmed of 7 (the rejected one is left out)
        queueCents: 4_000,
        queueCount: 2,
        needsReviewCount: 1,
        todayCents: 10_000, // the 05:59 UTC payment is yesterday
        last7DaysCents: 17_500, // 10_000 + 5_000 + 2_500
        last30DaysCents: 21_500, // + 4_000
        thisWeekCents: 15_000, // Monday to today: not the Sunday one
        thisWeekCount: 2,
        averageCents: 6_100,
        largestCents: 10_000,
      });
    });

    it("gives 21 days, oldest first, with quiet days at 0", async () => {
      const { trend } = await dashboard.get(NOW);
      expect(trend).toHaveLength(21);
      expect(trend[0]).toEqual({ day: "2026-10-16", amountCents: 0 });
      expect(trend.at(-1)).toEqual({ day: TODAY, amountCents: 10_000 });
      expect(trend.find((d) => d.day === "2026-11-04")?.amountCents).toBe(
        5_000,
      );
      expect(trend.find((d) => d.day === "2026-11-01")?.amountCents).toBe(
        2_500,
      );
      expect(trend.find((d) => d.day === "2026-11-02")?.amountCents).toBe(0);
      // 2026-10-10 is before the window, so the window holds only the three days above.
      expect(trend.reduce((sum, d) => sum + d.amountCents, 0)).toBe(17_500);
    });

    it("splits by source, biggest first, with the unmatched count of each", async () => {
      const { sources } = await dashboard.get(NOW);
      expect(sources).toEqual([
        {
          source: "manual",
          amountCents: 15_500,
          count: 3,
          unmatchedCount: 0,
          sharePercent: 51,
        },
        {
          source: "email_zelle",
          amountCents: 10_000,
          count: 1,
          unmatchedCount: 1,
          sharePercent: 33,
        },
        {
          source: "email_cashapp",
          amountCents: 5_000,
          count: 1,
          unmatchedCount: 1,
          sharePercent: 16,
        },
      ]);
    });
  });

  describe("drivers, rent due today and balances", () => {
    // 2026-11-05 is a Thursday. 2026-10-15 and 2026-10-22 are Thursdays too; 2026-10-12 is a Monday.
    beforeEach(async () => {
      const a = await driver("Daily", { rentFrom: "2026-10-01" });
      await contract(a, "daily", 6_000, "2026-10-01");
      const b = await driver("WeeklyThu", { rentFrom: "2026-10-15" });
      await contract(b, "weekly", 40_000, "2026-10-15"); // 21 days ago: due today
      const c = await driver("WeeklyMon", { rentFrom: "2026-10-12" });
      await contract(c, "weekly", 30_000, "2026-10-12"); // 24 days ago: not due today
      await driver("NoContract", { rentFrom: "2026-10-01" });
      const e = await driver("RentTomorrow", { rentFrom: "2026-11-06" });
      await contract(e, "weekly", 35_000, "2026-10-15"); // right weekday, but billing starts tomorrow
      // A new contract replaces the old one from its start date: $450 is in force and due today.
      const f = await driver("Rerate", { rentFrom: "2026-09-03" });
      await contract(f, "weekly", 30_000, "2026-09-03");
      await contract(f, "weekly", 45_000, "2026-10-22");
      const i = await driver("FutureContract", { rentFrom: "2026-11-01" });
      await contract(i, "weekly", 50_000, "2026-11-10"); // not started yet: nothing in force
      // A draft is not a contract.
      const draft = await driver("DraftOnly", { rentFrom: "2026-11-01" });
      await contract(draft, "daily", 7_000, "2026-11-01", false);

      // Left out of the active numbers: archived, inactive.
      const g = await driver("Archived", {
        archivedAt: NOW,
        rentFrom: "2026-10-01",
      });
      await contract(g, "daily", 8_000, "2026-10-01");
      const h = await driver("Gone", {
        status: DriverStatus.inactive,
        leftReason: DriverLeftReason.contractEnded,
      });
      await contract(h, "daily", 9_000, "2026-10-01");

      // Balances. A owes 30_000, B 6_000, C is 5_000 in credit, E is cancelled out by a reversal, F owes 1_500.
      await entry(a, "debit", 30_000);
      await entry(b, "debit", 10_000);
      await entry(b, "credit", 4_000);
      await entry(c, "credit", 5_000);
      const original = await entry(e, "debit", 2_000);
      await entry(e, "credit", 2_000, "reversal", original);
      await entry(f, "debit", 1_500);
      // The inactive driver owes 7_000; one in collections owes 20_000.
      await entry(h, "debit", 7_000);
      const j = await driver("Collections", {
        status: DriverStatus.inactive,
        leftReason: DriverLeftReason.badDriver,
        sentToCollectionsAt: NOW,
      });
      await entry(j, "debit", 20_000);
      // Never counted: archived (99_000) and onboarding (50_000).
      await entry(g, "debit", 99_000);
      const k = await driver("Onboarding", { status: DriverStatus.onboarding });
      await entry(k, "debit", 50_000);
    });

    it("counts active drivers by the contract in force", async () => {
      const { drivers } = await dashboard.get(NOW);
      // Active, not archived: Daily, WeeklyThu, WeeklyMon, NoContract, RentTomorrow, Rerate, FutureContract, DraftOnly.
      expect(drivers).toEqual({
        active: 8,
        daily: 1,
        weekly: 4, // WeeklyThu, WeeklyMon, RentTomorrow, Rerate
        withoutContract: 3, // NoContract, FutureContract, DraftOnly
        dailyPercent: 20,
        weeklyPercent: 80,
      });
    });

    it("bills today exactly what the rent job would post, and spreads weekly rent by weekday", async () => {
      const { billing } = await dashboard.get(NOW);
      expect(billing.dailyDueDrivers).toBe(1);
      expect(billing.dailyDueCents).toBe(6_000);
      expect(billing.weeklyDueDrivers).toBe(2); // WeeklyThu and Rerate ($450, not the old $300)
      expect(billing.weeklyDueCents).toBe(85_000);
      expect(billing.dueTodayCents).toBe(91_000);
      expect(billing.weeklyByDay.map((d) => d.weekday)).toEqual([
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ]);
      expect(billing.weeklyByDay[0]).toEqual({
        weekday: "monday",
        drivers: 1,
        expectedCents: 30_000,
      });
      // Thursday: WeeklyThu 40_000 + RentTomorrow 35_000 + Rerate 45_000 (an expected rent, billed or not today).
      expect(billing.weeklyByDay[3]).toEqual({
        weekday: "thursday",
        drivers: 3,
        expectedCents: 120_000,
      });
      expect(billing.weeklyByDay.filter((d) => d.drivers > 0)).toHaveLength(2);
    });

    it("adds up ledger balances of active and inactive drivers only", async () => {
      const { balances, billing } = await dashboard.get(NOW);
      // Counted: the 8 active ones, Gone and Collections. Not counted: Archived, Onboarding.
      expect(balances.driverCount).toBe(10);
      expect(balances.positiveCount).toBe(1);
      expect(balances.negativeCount).toBe(5); // Daily, WeeklyThu, Rerate, Gone, Collections
      expect(balances.zeroCount).toBe(4); // NoContract, RentTomorrow (reversed), FutureContract, DraftOnly
      expect(balances.creditCents).toBe(5_000);
      expect(balances.outstandingCents).toBe(64_500);
      expect(balances.fleetBalanceCents).toBe(-59_500);
      expect(billing.inactiveOwedCents).toBe(7_000);
      expect(billing.collectionsOwedCents).toBe(20_000);
      expect(balances.watchlist.map((w) => [w.name, w.balanceCents])).toEqual([
        ["Daily Driver", -30_000],
        ["Collections Driver", -20_000],
        ["Gone Driver", -7_000],
        ["WeeklyThu Driver", -6_000],
        ["Rerate Driver", -1_500],
      ]);
    });

    it("shows only the 8 who owe the most", async () => {
      for (let n = 1; n <= 10; n++) {
        const id = await driver(`Debtor${String(n).padStart(2, "0")}`);
        await entry(id, "debit", 100_000 + n * 100);
      }
      const { balances } = await dashboard.get(NOW);
      expect(balances.watchlist).toHaveLength(8);
      expect(balances.watchlist[0].name).toBe("Debtor10 Driver");
      expect(balances.watchlist[7].name).toBe("Debtor03 Driver");
    });
  });

  describe("applications, mailbox and texts", () => {
    it("counts applications by status, leaving archived ones out", async () => {
      await application("pending");
      await application("pending");
      await application("pending", true);
      await application("approved");
      await application("rejected");
      await application("on_hold");
      await driver("Onboarding", { status: DriverStatus.onboarding });
      await driver("OnboardingArchived", {
        status: DriverStatus.onboarding,
        archivedAt: NOW,
      });
      const { applications } = await dashboard.get(NOW);
      expect(applications).toEqual({
        total: 5,
        pending: 2,
        approved: 1,
        rejected: 1,
        onHold: 1,
        approvalPercent: 33,
        onboardingDrivers: 1,
      });
    });

    it("counts the mailbox by outcome over 24 hours and 7 days", async () => {
      await email(InboundEmailStatus.processed, 2);
      await email(InboundEmailStatus.processed, 72);
      await email(InboundEmailStatus.rejected_unverified, 1);
      await email(InboundEmailStatus.not_payment, 0.5);
      await email(InboundEmailStatus.duplicate_payment, 120);
      await email(InboundEmailStatus.extraction_failed, 8 * 24); // older than 7 days
      const driverId = await driver("Dana");
      await payment(
        1_000,
        "2026-11-05T12:00:00Z",
        PaymentSource.manual,
        PaymentStatus.unmatched,
        null,
        false,
      );
      await payment(
        1_000,
        "2026-11-05T12:00:00Z",
        PaymentSource.manual,
        PaymentStatus.confirmed,
        driverId,
      );
      const { intake } = await dashboard.get(NOW);
      expect(intake.last24Hours).toEqual({
        processed: 1,
        notPayment: 1,
        rejectedUnverified: 1,
        extractionFailed: 0,
        duplicatePayment: 0,
      });
      expect(intake.last7Days).toEqual({
        processed: 2,
        notPayment: 1,
        rejectedUnverified: 1,
        extractionFailed: 0,
        duplicatePayment: 1,
      });
      expect(intake.lastEmailAt).toEqual(
        new Date(NOW.getTime() - 0.5 * 3_600_000),
      );
      expect(intake.awaitingMatchCount).toBe(1);
    });

    it("counts failed texts of the last 7 days and reports the SMS mode", async () => {
      const insert = (
        status: string,
        daysAgo: number,
        direction = "outbound",
      ) =>
        db.query(
          `INSERT INTO sms_messages (direction, contact_phone, body, status, mode, error, occurred_at)
           VALUES ($1, '+13125550101', 'hi', $2, $3, $4, $5::timestamptz - ($6 || ' days')::interval)`,
          [
            direction,
            status,
            direction === "outbound" ? "live" : null,
            status === "failed" || status === "undelivered"
              ? "carrier refused"
              : null,
            NOW.toISOString(),
            String(daysAgo),
          ],
        );
      await insert("failed", 1);
      await insert("undelivered", 6);
      await insert("undelivered", 8); // too old
      await insert("delivered", 1);
      await insert("received", 1, "inbound");
      const { sms: figures } = await dashboard.get(NOW);
      expect(figures).toEqual({
        mode: "dry_run",
        quoConfigured: false,
        failedLast7Days: 2,
      });
    });
  });

  it("returns zeros and quiet days, never NaN, on an empty database", async () => {
    const result = await dashboard.get(NOW);
    expect(result.payments).toEqual({
      processedCents: 0,
      processedCount: 0,
      grossCents: 0,
      grossCount: 0,
      matchedPercent: 0,
      queueCents: 0,
      queueCount: 0,
      needsReviewCount: 0,
      todayCents: 0,
      last7DaysCents: 0,
      last30DaysCents: 0,
      thisWeekCents: 0,
      thisWeekCount: 0,
      averageCents: 0,
      largestCents: 0,
    });
    expect(result.trend).toHaveLength(21);
    expect(result.trend.every((d) => d.amountCents === 0)).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.drivers).toEqual({
      active: 0,
      daily: 0,
      weekly: 0,
      withoutContract: 0,
      dailyPercent: 0,
      weeklyPercent: 0,
    });
    expect(result.billing.dueTodayCents).toBe(0);
    expect(result.billing.weeklyByDay).toHaveLength(7);
    expect(result.balances).toEqual({
      driverCount: 0,
      fleetBalanceCents: 0,
      positiveCount: 0,
      zeroCount: 0,
      negativeCount: 0,
      creditCents: 0,
      outstandingCents: 0,
      watchlist: [],
    });
    expect(result.applications.approvalPercent).toBe(0);
    expect(result.intake.lastEmailAt).toBeNull();
    expect(result.intake.lastRun).toBeNull();
    expect(JSON.stringify(result)).not.toContain("NaN");
  });
});
