import "reflect-metadata";
import { vi } from "vitest";
import type { DataSource } from "typeorm";
import { DailyOperationsService } from "../src/dashboard/daily-ops.service.js";
import { Driver, DriverStatus } from "../src/drivers/driver.entity.js";
import { MessageTemplate } from "../src/message-templates/message-template.entity.js";
import { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import { AppSetting } from "../src/settings/app-setting.entity.js";
import { SettingsService } from "../src/settings/settings.service.js";
import { RemindersJob } from "../src/reminders/reminders.job.js";
import { RemindersService } from "../src/reminders/reminders.service.js";
import {
  QuoApiError,
  type QuoClient,
  type QuoMessage,
  type QuoMessagePage,
} from "../src/sms/quo/quo-client.js";
import { SmsService } from "../src/sms/sms.service.js";
import { openTestDatabase } from "./test-database.js";

/** A Quo in memory: records what it was asked to send; `failWith` makes every send fail. */
class FakeQuo implements QuoClient {
  sent: { to: string; text: string }[] = [];
  attempts = 0;
  failWith: Error | null = null;

  sendText(to: string, text: string): Promise<QuoMessage> {
    this.attempts++;
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ to, text });
    return Promise.resolve({
      id: `ACrem${this.sent.length}`,
      direction: "outgoing",
      from: "+13127362939",
      to: [to],
      text,
      status: "queued",
      createdAt: new Date(),
      media: [],
      errorCode: null,
    });
  }

  listConversation(): Promise<QuoMessagePage> {
    return Promise.resolve({ messages: [], nextPageToken: null });
  }
}

/**
 * Hand-worked scenarios for the payment reminders (Fleet revisions section 6). All clocks are in October 2026, when Chicago
 * is on CDT (UTC-5): `2026-10-21T20:00:00Z` is Wednesday 3:00 PM. Rent charges are written straight into the ledger, dated
 * their due date, the way the rent job leaves them; a daily driver with no due time is late once the due day has ended.
 * The texts are tiny fixed templates, so each assertion reads the whole text.
 */
const WED_3PM = new Date("2026-10-21T20:00:00Z");
const hours = (from: Date, h: number) =>
  new Date(from.getTime() + h * 3_600_000);

describe("Payment reminders (Fleet revisions section 6, test database)", () => {
  let db: DataSource;
  let quo: FakeQuo;
  let admin: string;
  let seq = 0;

  /** The service, wired like the app, with the given SMS mode. */
  const build = (mode: "off" | "dry_run" | "live" = "live") => {
    const sms = new SmsService(db, {
      mode,
      quo,
      phoneNumberId: "PNtest",
      storage: null,
    });
    const ops = new DailyOperationsService(db);
    const reminders = new RemindersService(
      db,
      ops,
      sms,
      new MessageTemplatesService(db.getRepository(MessageTemplate)),
      new SettingsService(db.getRepository(AppSetting)),
    );
    return { reminders, ops, sms };
  };

  const settings = () => new SettingsService(db.getRepository(AppSetting));
  const switchOn = (
    paymentLink: string | null = null,
    at: Date = new Date("2026-10-01T00:00:00Z"),
  ) => settings().saveReminders({ enabled: true, paymentLink }, admin, at);

  const logs = () =>
    db.query(
      `SELECT kind, tier, status, mode, error, body, past_due_cents AS "pastDue", balance_cents AS balance
       FROM reminder_logs ORDER BY created_at, id`,
    ) as Promise<
      {
        kind: string;
        tier: number | null;
        status: string;
        mode: string;
        error: string | null;
        body: string;
        pastDue: number;
        balance: number;
      }[]
    >;
  const texts = () => quo.sent.map((s) => s.text);

  async function driver(
    name: string,
    overrides: Partial<Driver> = {},
  ): Promise<string> {
    const done = new Date("2026-09-01T12:00:00Z");
    const saved = await db.getRepository(Driver).save({
      firstName: name,
      lastName: "Driver",
      email: `${name.toLowerCase()}@test.dev`,
      phone: "+13125550101",
      status: DriverStatus.active,
      contractSignedAt: done,
      depositPaidAt: done,
      vehicleAssignedAt: done,
      rentFrom: "2026-10-01",
      ...overrides,
    });
    return saved.id;
  }

  async function contract(
    driverId: string,
    schedule: "daily" | "weekly",
    rateCents: number,
    startDate: string,
  ) {
    await db.query(
      `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date, term_months, security_deposit_cents,
                              status, signed_at, sent_at, firma_signing_request_id, sent_values)
       VALUES ($1, $2, $3, $4, 18, 0, 'signed', $5, $6, $7, '{}')`,
      [
        driverId,
        schedule,
        rateCents,
        startDate,
        `${startDate}T15:00:00Z`,
        `${startDate}T12:00:00Z`,
        `firma-${++seq}`,
      ],
    );
  }

  /** A ledger entry; `at` is when it was recorded (matters for payments: it resets the 3-day clock). */
  async function entry(
    driverId: string,
    direction: "debit" | "credit",
    cents: number,
    day: string,
    kind: "rent" | "payment",
    at: Date = new Date("2026-10-01T12:00:00Z"),
  ): Promise<string> {
    let paymentId: string | null = null;
    if (kind === "payment") {
      [{ id: paymentId }] = (await db.query(
        `INSERT INTO payments (source, external_id, amount_cents, sender_name, occurred_at, extraction_confidence, status, driver_id, match_method)
         VALUES ('email_venmo', $1, $2, 'Pat S', $3, 1, 'confirmed', $4, 'manual') RETURNING id`,
        [`ext-${++seq}`, cents, at, driverId],
      )) as [{ id: string }];
    }
    const [row] = (await db.query(
      `INSERT INTO ledger_entries (driver_id, direction, amount_cents, kind, description, effective_date, payment_id, idempotency_key, created_by_id, created_at)
       VALUES ($1, $2, $3, $4, 'test', $5, $6, $7, NULL, $8) RETURNING id`,
      [driverId, direction, cents, kind, day, paymentId, `test:${++seq}`, at],
    )) as { id: string }[];
    return row.id;
  }

  const rent = (id: string, cents: number, day: string) =>
    entry(id, "debit", cents, day, "rent");
  const paid = (id: string, cents: number, day: string, at: Date) =>
    entry(id, "credit", cents, day, "payment", at);

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE reminder_logs, app_settings, sms_messages, ledger_entries, payments, contracts, applications, drivers, users CASCADE",
    );
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    await db.query(
      `INSERT INTO message_templates (kind, name, body) VALUES
         ('reminder_upcoming', 'Default', 'UP {firstName} {amount} {due}' || chr(10) || 'Pay: {paymentLink}'),
         ('reminder_late', 'Default', 'LATE {firstName} {balance}' || chr(10) || 'Pay: {paymentLink}'),
         ('reminder_high_balance', 'Default', 'HIGH {firstName} {missedCount} {balance}' || chr(10) || 'Pay: {paymentLink}'),
         ('reminder_balance', 'Default', 'BAL {firstName} {balance}' || chr(10) || 'Pay: {paymentLink}'),
         ('reminder_payment_received', 'Default', 'THANKS {firstName} {balance}' || chr(10) || 'Pay: {paymentLink}')`,
    );
    quo = new FakeQuo();
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** Dan: a $70 daily driver, due at the end of each day, charges posted for the 18th to the 20th (3 behind on Wed 3 PM). */
  async function dan(): Promise<string> {
    const id = await driver("Dan");
    await contract(id, "daily", 7_000, "2026-10-14");
    for (const day of ["2026-10-18", "2026-10-19", "2026-10-20"]) {
      await rent(id, 7_000, day);
    }
    return id;
  }

  it("does nothing while the switch is off (the default): no text, no log", async () => {
    await dan();
    const { reminders } = build("live");

    const summary = await reminders.run(WED_3PM);

    expect(summary).toMatchObject({ skipped: "switched off", sent: 0 });
    expect(quo.attempts).toBe(0);
    expect(await logs()).toHaveLength(0);
  });

  it("does nothing when texting is off (SMS_MODE=off), even with the switch on", async () => {
    await dan();
    await switchOn();

    const summary = await build("off").reminders.run(WED_3PM);

    expect(summary.skipped).toMatch(/texting is off/);
    expect(await logs()).toHaveLength(0);
    expect(await db.query(`SELECT 1 FROM sms_messages`)).toHaveLength(0);
  });

  it("dry_run composes and saves the text but sends nothing, and the log says so", async () => {
    await dan();
    await switchOn();

    const summary = await build("dry_run").reminders.run(WED_3PM);

    expect(summary).toMatchObject({ composed: 1, sent: 0, failed: 0 });
    expect(quo.attempts).toBe(0);
    expect(await logs()).toMatchObject([
      {
        kind: "high_balance",
        tier: 3,
        status: "composed",
        mode: "dry_run",
        body: "HIGH Dan 3 $210.00",
        pastDue: 21_000,
        balance: -21_000,
      },
    ]);
    const saved = (await db.query(
      `SELECT body, status, mode FROM sms_messages`,
    )) as { body: string; status: string; mode: string }[];
    expect(saved).toEqual([
      { body: "HIGH Dan 3 $210.00", status: "composed", mode: "dry_run" },
    ]);

    // The rehearsal never blocks the real thing: the same reminder is sent once the mode is live.
    const live = await build("live").reminders.run(hours(WED_3PM, 1));
    expect(live.sent).toBe(1);
    expect(texts()).toEqual(["HIGH Dan 3 $210.00"]);
  });

  it("a daily driver: 3, 4 and 5 behind each get their own text, never two on a day, and the balance reminder comes every 3 days", async () => {
    const id = await dan();
    await switchOn();
    const { reminders } = build("live");

    // Wed 3 PM: 18th, 19th, 20th late = 3 x $70 = $210. High balance wins over late and balance. Link unset: that line is left out.
    await reminders.run(WED_3PM);
    expect(texts()).toEqual(["HIGH Dan 3 $210.00"]);
    // The same day, a later run: one text a day.
    await reminders.run(hours(WED_3PM, 1));
    expect(quo.sent).toHaveLength(1);

    // Thu 3 PM: the 21st is posted and late too = 4 x $70 = $280.
    await rent(id, 7_000, "2026-10-21");
    await reminders.run(hours(WED_3PM, 24));
    // Fri: 5 behind = $350.
    await rent(id, 7_000, "2026-10-22");
    await reminders.run(hours(WED_3PM, 48));
    expect(texts()).toEqual([
      "HIGH Dan 3 $210.00",
      "HIGH Dan 4 $280.00",
      "HIGH Dan 5 $350.00",
    ]);

    // Sat: 6 behind, no tier 6; the last text was 24 hours ago, so the 3-day clock has not run out.
    await rent(id, 7_000, "2026-10-23");
    await reminders.run(hours(WED_3PM, 72));
    expect(quo.sent).toHaveLength(3);

    // Mon 3 PM = 120 hours after the first text, 72 hours after Friday's: 25th and 26th... charges 18th to 25th = 8 x $70 = $560.
    await rent(id, 7_000, "2026-10-24");
    await rent(id, 7_000, "2026-10-25");
    await reminders.run(hours(WED_3PM, 120));
    expect(texts().at(-1)).toBe("BAL Dan $560.00");
    expect((await logs()).map((l) => l.kind)).toEqual([
      "high_balance",
      "high_balance",
      "high_balance",
      "balance",
    ]);
  });

  it("a driver who has paid is not messaged: the balance is worked out again right before the send", async () => {
    const id = await driver("Pat");
    await contract(id, "daily", 7_000, "2026-10-14");
    await rent(id, 7_000, "2026-10-19");
    await rent(id, 7_000, "2026-10-20"); // 2 behind = $140 on Wed 3 PM
    await switchOn();
    const { reminders, ops } = build("live");
    // The driver pays $140 after the pass over all drivers but before this driver's send.
    const original = ops.driverFigures.bind(ops);
    vi.spyOn(ops, "driverFigures").mockImplementation(async (now, ids) => {
      if (ids) await paid(id, 14_000, "2026-10-21", hours(WED_3PM, -0.01));
      return original(now, ids);
    });

    const summary = await reminders.run(WED_3PM);

    expect(summary.sent).toBe(0);
    expect(quo.attempts).toBe(0);
    expect(await logs()).toHaveLength(0);
  });

  it("a driver who paid up and falls behind again is warned again (each threshold once per time behind)", async () => {
    const id = await driver("Eli");
    await contract(id, "daily", 7_000, "2026-10-14");
    await rent(id, 7_000, "2026-10-19");
    await rent(id, 7_000, "2026-10-20");
    await switchOn();
    const { reminders } = build("live");

    await reminders.run(WED_3PM); // 2 behind: tier 2
    // Pays everything the next morning; the run that sees him caught up closes the stretch.
    await paid(id, 14_000, "2026-10-22", hours(WED_3PM, 18));
    await reminders.run(hours(WED_3PM, 19));
    // A week later he is behind twice again.
    await rent(id, 7_000, "2026-10-26");
    await rent(id, 7_000, "2026-10-27");
    await reminders.run(hours(WED_3PM, 24 * 7 + 6));

    expect(texts()).toEqual(["HIGH Eli 2 $140.00", "HIGH Eli 2 $140.00"]);
  });

  it("a weekly driver: one late text for a missed payment, then a balance reminder every 3 days; a payment resets the clock and gets a confirmation", async () => {
    const id = await driver("Wes");
    await contract(id, "weekly", 35_000, "2026-10-07");
    await rent(id, 35_000, "2026-10-14");
    // Due Wed Oct 14 at 6 PM (his due time).
    await db.query(`UPDATE drivers SET rent_due_time = '18:00' WHERE id = $1`, [
      id,
    ]);
    await switchOn("https://pay.test/wes");
    const { reminders } = build("live");
    const THU_NOON = new Date("2026-10-15T17:00:00Z"); // Thursday 12:00 PM CDT: 18 hours late

    await reminders.run(THU_NOON);
    // $350 past due is over $100, but "late" goes first; the link is added on its own line.
    expect(texts()).toEqual(["LATE Wes $350.00\nPay: https://pay.test/wes"]);

    // 71 hours later: not yet. 72 hours later: the balance reminder.
    await reminders.run(hours(THU_NOON, 71));
    expect(quo.sent).toHaveLength(1);
    await reminders.run(hours(THU_NOON, 72));
    expect(texts().at(-1)).toBe("BAL Wes $350.00\nPay: https://pay.test/wes");

    // A $100 payment lands 10 hours later (Sun 10 PM): the confirmation says $250.00 is still past due,
    // and the 3-day clock starts again from the payment, so nothing more goes out for 72 hours.
    const payAt = hours(THU_NOON, 82);
    await paid(id, 10_000, "2026-10-18", payAt);
    await reminders.run(hours(payAt, 0.25));
    expect(texts().at(-1)).toBe(
      "THANKS Wes $250.00\nPay: https://pay.test/wes",
    );
    const count = quo.sent.length;
    await reminders.run(hours(payAt, 0.5)); // the confirmation is sent once
    await reminders.run(hours(payAt, 71));
    expect(quo.sent).toHaveLength(count);
    await reminders.run(hours(payAt, 72.5));
    expect(texts().at(-1)).toBe("BAL Wes $250.00\nPay: https://pay.test/wes");
    expect((await logs()).map((l) => l.kind)).toEqual([
      "late",
      "balance",
      "payment_received",
      "balance",
    ]);
  });

  it("a weekly driver gets the upcoming text 48 hours before the due time, once, with the date and time", async () => {
    const id = await driver("Uma", { rentDueTime: "18:00:00" });
    await contract(id, "weekly", 35_000, "2026-10-14");
    await rent(id, 35_000, "2026-10-14");
    await paid(id, 35_000, "2026-10-14", new Date("2026-10-14T20:00:00Z"));
    await switchOn();
    const { reminders } = build("live");

    // The next due moment is Wed 2026-10-21 6 PM CDT; the window opens Mon 2026-10-19 6 PM CDT = 23:00Z.
    await reminders.run(new Date("2026-10-19T22:59:00Z"));
    expect(quo.sent).toHaveLength(0);
    await reminders.run(new Date("2026-10-19T23:00:00Z"));
    expect(texts()).toEqual(["UP Uma $350.00 Wednesday, Oct 21 at 6:00 PM"]);
    await reminders.run(new Date("2026-10-20T20:00:00Z"));
    expect(quo.sent).toHaveLength(1);

    // Switched off for this driver: nothing, even in the window.
    await db.query(`DELETE FROM reminder_logs`);
    await db.query(
      `UPDATE drivers SET upcoming_reminders_enabled = false WHERE id = $1`,
      [id],
    );
    await reminders.run(new Date("2026-10-20T21:00:00Z"));
    expect(quo.sent).toHaveLength(1);
  });

  it("never texts a driver who texted STOP, an archived or inactive driver, one in collections, or one still onboarding", async () => {
    const stopped = await dan();
    await db.query(`UPDATE drivers SET sms_opted_out = true WHERE id = $1`, [
      stopped,
    ]);
    const others: [string, Partial<Driver>][] = [
      ["Archie", { archivedAt: new Date("2026-10-20T12:00:00Z") }],
      [
        "Ina",
        {
          status: DriverStatus.inactive,
          leftReason: "contract_ended" as never,
          leftAt: new Date("2026-10-10T12:00:00Z"),
        },
      ],
      [
        "Cole",
        {
          status: DriverStatus.inactive,
          leftReason: "bad_driver" as never,
          leftAt: new Date("2026-10-10T12:00:00Z"),
          sentToCollectionsAt: new Date("2026-10-12T12:00:00Z"),
        },
      ],
      [
        "Ollie",
        {
          status: DriverStatus.onboarding,
          contractSignedAt: null,
          depositPaidAt: null,
          vehicleAssignedAt: null,
        },
      ],
    ];
    for (const [name, extra] of others) {
      const id = await driver(name, extra);
      await contract(id, "daily", 7_000, "2026-10-14");
      await rent(id, 7_000, "2026-10-18");
      await rent(id, 7_000, "2026-10-19");
    }
    await switchOn();

    const summary = await build("live").reminders.run(WED_3PM);

    expect(summary.sent).toBe(0);
    expect(quo.attempts).toBe(0);
    expect(await logs()).toHaveLength(0);
  });

  it("staff can turn balance reminders off for a driver", async () => {
    const id = await driver("Bea");
    await contract(id, "weekly", 35_000, "2026-10-07");
    await rent(id, 35_000, "2026-10-14");
    await db.query(
      `UPDATE drivers SET rent_due_time = '18:00', balance_reminders_enabled = false WHERE id = $1`,
      [id],
    );
    await switchOn();
    const { reminders } = build("live");
    const THU_NOON = new Date("2026-10-15T17:00:00Z");

    await reminders.run(THU_NOON); // the late text is not a balance reminder
    await reminders.run(hours(THU_NOON, 24 * 7));

    expect(texts()).toEqual(["LATE Bea $350.00"]);
  });

  it("Quo refusing a text is recorded with the reason, retried only after an hour, and given up after 5 failures", async () => {
    await dan();
    await switchOn();
    const { reminders } = build("live");
    quo.failWith = new QuoApiError(402, "Quo refused", "no credits");

    const first = await reminders.run(WED_3PM);
    expect(first).toMatchObject({ failed: 1, sent: 0 });
    expect(await logs()).toMatchObject([
      {
        kind: "high_balance",
        status: "failed",
        mode: "live",
        error:
          "The Quo account has no credits left or its subscription has lapsed. Ask the account owner to add credits.",
      },
    ]);

    // 30 minutes later: not retried. An hour later: retried (and refused again).
    await reminders.run(hours(WED_3PM, 0.5));
    expect(quo.attempts).toBe(1);
    await reminders.run(hours(WED_3PM, 1.01));
    expect(quo.attempts).toBe(2);
    for (let i = 2; i < 8; i++) {
      await reminders.run(hours(WED_3PM, i * 1.01 + 0.01));
    }
    expect(quo.attempts).toBe(5); // given up after 5 failures
    expect((await logs()).every((l) => l.status === "failed")).toBe(true);
  });

  it("a failed send does not use up the reminder: once Quo works it goes out and counts as the day's text", async () => {
    await dan();
    await switchOn();
    const { reminders } = build("live");
    quo.failWith = new QuoApiError(402, "Quo refused", "no credits");
    await reminders.run(WED_3PM);
    quo.failWith = null;

    await reminders.run(hours(WED_3PM, 2));
    await reminders.run(hours(WED_3PM, 3));

    expect(texts()).toEqual(["HIGH Dan 3 $210.00"]);
    expect((await logs()).map((l) => l.status)).toEqual(["failed", "sent"]);
  });

  it("only one run at a time: a run started while another holds the lock does nothing", async () => {
    await dan();
    await switchOn();
    const { reminders } = build("live");
    const job = new RemindersJob(db, reminders);
    const holder = db.createQueryRunner();
    await holder.connect();
    await holder.query("SELECT pg_advisory_lock(7302005)");
    try {
      expect(await job.run(WED_3PM)).toBeNull();
    } finally {
      await holder.query("SELECT pg_advisory_unlock(7302005)");
      await holder.release();
    }
    expect((await job.run(WED_3PM))?.sent).toBe(1);
  });

  it("turning the switch on records when, so payments made before it never get a confirmation", async () => {
    const id = await dan();
    const enableAt = hours(WED_3PM, 0);
    await paid(id, 5_000, "2026-10-21", hours(enableAt, -3)); // paid 3 hours before the switch was turned on
    await switchOn(null, enableAt);
    const { reminders } = build("live");

    await reminders.run(hours(enableAt, 0.1));

    // Behind, so the high-balance text goes; no THANKS for the earlier payment.
    expect(texts().some((t) => t.startsWith("THANKS"))).toBe(false);
    expect(await settings().reminders()).toMatchObject({
      enabled: true,
      enabledAt: enableAt,
      paymentLink: null,
    });
  });
});
