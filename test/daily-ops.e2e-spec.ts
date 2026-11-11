import "reflect-metadata";
import type { DataSource } from "typeorm";
import { DailyOperationsService } from "../src/dashboard/daily-ops.service.js";
import { Driver, DriverStatus } from "../src/drivers/driver.entity.js";
import {
  MatchMethod,
  Payment,
  PaymentSource,
  PaymentStatus,
} from "../src/payments/payment.entity.js";
import { openTestDatabase } from "./test-database.js";

/**
 * The daily operations lists (Dashboard page 1, D92), worked out by hand. The default clock is Wednesday 2026-10-21,
 * 6:30 PM in Chicago (23:30 UTC; Chicago is on CDT, UTC-5, until 2026-11-01), so "today" is Wednesday the 21st and a
 * driver due at 6 PM is already 30 minutes late. Ledger entries are written straight into the table, the way the rent
 * job and the payment matcher leave them: rent debits dated their due date, credits as one pool paid oldest first.
 */
const WED_630PM = new Date("2026-10-21T23:30:00Z");
const TODAY = "2026-10-21";

describe("Daily operations: due today, late, early warning (D92, test database)", () => {
  let db: DataSource;
  let service: DailyOperationsService;
  let admin: string;
  let seq = 0;
  /** The driver the test payments are credited to (the weekly totals do not care which). */
  let payerId: string;

  beforeAll(async () => {
    db = await openTestDatabase();
    service = new DailyOperationsService(db);
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE ledger_entries, payments, payment_aliases, contracts, applications, drivers, users CASCADE",
    );
    [{ id: admin }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('alice@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** A driver; `active` by default (the three onboarding steps done, as the database requires). */
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
      // `left_reason` and `left_at` come together; collections need a reason (the CHECKs on drivers).
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
    vehicle: { model: string | null; plate: string | null } = {
      model: null,
      plate: null,
    },
    depositCents = 0,
  ) {
    await db.query(
      `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date, term_months, security_deposit_cents,
                              status, signed_at, sent_at, firma_signing_request_id, sent_values, vehicle_model, vehicle_plate)
       VALUES ($1, $2, $3, $4, 18, $10, 'signed', $5, $6, $7, '{}', $8, $9)`,
      [
        driverId,
        schedule,
        rateCents,
        startDate,
        `${startDate}T15:00:00Z`,
        `${startDate}T12:00:00Z`,
        `firma-${++seq}`,
        vehicle.model,
        vehicle.plate,
        depositCents,
      ],
    );
  }

  /** A ledger entry dated `day`. Returns its id. */
  async function entry(
    driverId: string,
    direction: "debit" | "credit",
    cents: number,
    day: string,
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
        day,
        `test:${++seq}`,
        reversalOfId,
        admin,
      ],
    )) as { id: string }[];
    return row.id;
  }

  const rent = (id: string, cents: number, day: string) =>
    entry(id, "debit", cents, day);
  const paid = (id: string, cents: number, day = TODAY) =>
    entry(id, "credit", cents, day);

  /**
   * A weekly $200 driver due on Wednesdays (start 2026-10-14) with rent posted for the 14th and the 21st, who has paid
   * `paidCents` in all: $200 pays the 14th, $400 both, anything between is part of the 21st.
   */
  async function weekly(
    name: string,
    paidCents: number,
    overrides: Partial<Driver> = {},
    vehicle?: { model: string; plate: string },
  ) {
    const id = await driver(name, { rentDueTime: "18:00", ...overrides });
    await contract(id, "weekly", 20_000, "2026-10-14", vehicle);
    await rent(id, 20_000, "2026-10-14");
    await rent(id, 20_000, TODAY);
    if (paidCents > 0) await paid(id, paidCents, "2026-10-14");
    return id;
  }

  /** An onboarding driver with a signed contract that asks for a $200 deposit, due on `start`. */
  async function onboarding(
    name: string,
    start: string,
    overrides: Partial<Driver> = {},
    depositCents = 20_000,
  ) {
    const id = await driver(name, {
      status: DriverStatus.onboarding,
      contractSignedAt: new Date(`${start}T15:00:00Z`),
      ...overrides,
    });
    await contract(id, "weekly", 20_000, start, undefined, depositCents);
    if (depositCents > 0) {
      await entry(id, "debit", depositCents, start, "contract_charge");
    }
    return id;
  }

  /** A confirmed (matched) payment of `cents` that came in at `occurredAt`. */
  async function payment(
    cents: number,
    occurredAt: string,
    status = PaymentStatus.confirmed,
    driverId: string | null = payerId,
  ) {
    await db.getRepository(Payment).insert({
      source: PaymentSource.email_zelle,
      externalId: `ext-${++seq}`,
      transactionId: null,
      amountCents: cents,
      senderName: "Pat Example",
      senderHandle: null,
      occurredAt: new Date(occurredAt),
      extractionConfidence: null,
      status,
      driverId: status === PaymentStatus.confirmed ? driverId : null,
      matchMethod:
        status === PaymentStatus.confirmed ? MatchMethod.manual : null,
      matchAttemptedAt:
        status === PaymentStatus.confirmed ? null : new Date(occurredAt),
    });
  }

  it("is empty, in the right shape, with no drivers", async () => {
    const empty = await service.get(WED_630PM);
    expect(empty).toMatchObject({
      asOf: WED_630PM,
      today: TODAY,
      dueToday: [],
      late: [],
      earlyWarning: [],
      shouldBeDeactivated: [],
      depositsCollected: { totalCents: 0, withoutAmountCount: 0, drivers: [] },
      depositsPending: { totalCents: 0, drivers: [] },
      collections: { totalOwedCents: 0, drivers: [] },
    });
    // 26 weeks, newest first, every one a Monday-to-Sunday of 0.
    expect(empty.weeks).toHaveLength(26);
    expect(
      empty.weeks.every((w) => w.totalCents === 0 && w.paymentCount === 0),
    ).toBe(true);
  });

  describe("payments due today", () => {
    it("shows each weekly driver with the status of today's rent, then the daily drivers", async () => {
      const wendy = await weekly(
        "Wendy",
        20_000,
        {},
        { model: "Toyota Prius", plate: "ABC123" },
      );
      await weekly("Paula", 40_000);
      await weekly("Nina", 20_000, { rentDueTime: "20:00" });
      const dan = await driver("Dan"); // daily, no due time
      await contract(dan, "daily", 5_000, "2026-10-18");
      await rent(dan, 5_000, TODAY);

      const { dueToday } = await service.get(WED_630PM);

      // Weekly first, by name (Nina, Paula, Wendy), then daily.
      expect(
        dueToday.map((row) => [row.name, row.schedule, row.status]),
      ).toEqual([
        ["Nina Driver", "weekly", "not_yet_paid"], // due 8 PM, it is 6:30 PM
        ["Paula Driver", "weekly", "paid"], // $400 paid both weeks
        ["Wendy Driver", "weekly", "late"], // due 6 PM, $200 paid went to last week's rent
        ["Dan Driver", "daily", "not_yet_paid"], // no time set: due when the day ends
      ]);
      const row = dueToday.find((r) => r.driverId === wendy);
      expect(row).toMatchObject({
        vehicle: "Toyota Prius (ABC123)",
        rateCents: 20_000,
        dueTime: "18:00",
        amountDueCents: 20_000,
        openCents: 20_000,
        onPaymentPlan: false,
      });
      expect(dueToday.find((r) => r.name === "Dan Driver")).toMatchObject({
        dueTime: null,
        vehicle: null,
        rateCents: 5_000,
      });
    });

    it("shows a partly paid rent as late with what is open, and a driver paid ahead as paid", async () => {
      const gina = await weekly("Gina", 30_000); // $200 + $100 of this week's rent
      const { dueToday } = await service.get(WED_630PM);
      expect(dueToday).toMatchObject([
        {
          driverId: gina,
          status: "late",
          amountDueCents: 20_000,
          openCents: 10_000,
        },
      ]);
    });

    it("pays the deposit and fee posted at signing before the first rent", async () => {
      // Fiona signs today: deposit $200 + fee $50 + first rent $200 are dated today. $450 clears all three, $300 leaves $150 of the rent.
      const fiona = await driver("Fiona", { rentDueTime: "18:00" });
      await contract(fiona, "weekly", 20_000, TODAY);
      await entry(fiona, "debit", 20_000, TODAY, "contract_charge");
      await entry(fiona, "debit", 5_000, TODAY, "contract_charge");
      await rent(fiona, 20_000, TODAY);
      await paid(fiona, 45_000);
      const gus = await driver("Gus", { rentDueTime: "18:00" });
      await contract(gus, "weekly", 20_000, TODAY);
      await entry(gus, "debit", 20_000, TODAY, "contract_charge");
      await entry(gus, "debit", 5_000, TODAY, "contract_charge");
      await rent(gus, 20_000, TODAY);
      await paid(gus, 30_000);

      const result = await service.get(WED_630PM);
      expect(
        result.dueToday.map((r) => [r.name, r.status, r.openCents]),
      ).toEqual([
        ["Fiona Driver", "paid", 0],
        ["Gus Driver", "late", 15_000],
      ]);
      // A late deposit is never a late payment: only Gus's rent is.
      expect(result.late.map((r) => [r.name, r.pastDueCents])).toEqual([
        ["Gus Driver", 15_000],
      ]);
    });

    it("moves from Not yet paid to Late at the due time and not a second before", async () => {
      await weekly("Wendy", 20_000);
      const status = async (iso: string) =>
        (await service.get(new Date(iso))).dueToday[0].status;
      expect(await status("2026-10-21T22:00:00Z")).toBe("not_yet_paid"); // 5:00 PM
      expect(await status("2026-10-21T23:00:00Z")).toBe("not_yet_paid"); // 6:00 PM sharp
      expect(await status("2026-10-21T23:00:01Z")).toBe("late");
    });
  });

  describe("late payments and early warning", () => {
    it("lists a driver as late from the due time, 0 days, and not yet as early warning", async () => {
      const wendy = await weekly("Wendy", 20_000);
      const { late, earlyWarning } = await service.get(WED_630PM);
      expect(late).toEqual([
        {
          driverId: wendy,
          name: "Wendy Driver",
          schedule: "weekly",
          dueTime: "18:00",
          pastDueCents: 20_000,
          lateCount: 1,
          daysLate: 0,
          hoursLate: 0,
          onPaymentPlan: false,
        },
      ]);
      expect(earlyWarning).toEqual([]);
    });

    it("flags early warning at the same time the next day, the client's example (due Wednesday 6 PM, flagged Thursday 6 PM)", async () => {
      const wendy = await weekly("Wendy", 20_000);
      const lists = async (iso: string) => service.get(new Date(iso));
      const thu1759 = await lists("2026-10-22T22:59:00Z");
      expect(thu1759.late).toHaveLength(1);
      expect(thu1759.earlyWarning).toEqual([]);
      const thu1800 = await lists("2026-10-22T23:00:00Z");
      expect(thu1800.earlyWarning).toMatchObject([
        { driverId: wendy, daysLate: 1, hoursLate: 24, pastDueCents: 20_000 },
      ]);
    });

    it("adds up every late charge, takes the days from the oldest, and orders the longest late first", async () => {
      // Eddie: three weekly rents (7th, 14th, 21st), $200 paid: the 7th is paid, the 14th (7 days late) and the 21st (30 min) are open.
      const eddie = await driver("Eddie", { rentDueTime: "18:00" });
      await contract(eddie, "weekly", 20_000, "2026-10-07");
      for (const day of ["2026-10-07", "2026-10-14", TODAY])
        await rent(eddie, 20_000, day);
      await paid(eddie, 20_000, "2026-10-07");
      const wendy = await weekly("Wendy", 20_000);

      const { late, earlyWarning } = await service.get(WED_630PM);
      expect(late.map((r) => r.driverId)).toEqual([eddie, wendy]);
      expect(late[0]).toMatchObject({
        pastDueCents: 40_000,
        lateCount: 2,
        daysLate: 7,
        hoursLate: 168,
      });
      expect(earlyWarning.map((r) => r.driverId)).toEqual([eddie]);
    });

    it("counts a daily driver with no due time late when each due day has ended", async () => {
      // Dan: daily $50 rent for the 19th, 20th and 21st, nothing paid. The 19th was due at midnight starting the 20th (42.5 h ago).
      const dan = await driver("Dan");
      await contract(dan, "daily", 5_000, "2026-10-18");
      for (const day of ["2026-10-19", "2026-10-20", TODAY])
        await rent(dan, 5_000, day);

      const { late, earlyWarning } = await service.get(WED_630PM);
      expect(late).toMatchObject([
        {
          driverId: dan,
          schedule: "daily",
          dueTime: null,
          pastDueCents: 10_000,
          lateCount: 2,
          daysLate: 1,
          hoursLate: 42,
        },
      ]);
      expect(earlyWarning.map((r) => r.driverId)).toEqual([dan]);
    });

    it("leaves a reversed rent charge out, so reversing a wrong charge makes the driver current", async () => {
      // Reggie: the 14th's rent was a mistake and reversed; his $200 payment then pays the 21st.
      const reggie = await driver("Reggie", { rentDueTime: "18:00" });
      await contract(reggie, "weekly", 20_000, "2026-10-14");
      const mistake = await rent(reggie, 20_000, "2026-10-14");
      await entry(reggie, "credit", 20_000, "2026-10-14", "reversal", mistake);
      await rent(reggie, 20_000, TODAY);
      await paid(reggie, 20_000);

      const { dueToday, late } = await service.get(WED_630PM);
      expect(dueToday.map((r) => [r.name, r.status])).toEqual([
        ["Reggie Driver", "paid"],
      ]);
      expect(late).toEqual([]);
    });

    it("keeps a driver on a payment plan in the lists and says so", async () => {
      const pam = await weekly("Pam", 20_000, { onPaymentPlan: true });
      const { late } = await service.get(WED_630PM);
      expect(late).toMatchObject([{ driverId: pam, onPaymentPlan: true }]);
    });

    it("does not list a driver who is archived, inactive, in collections or still onboarding", async () => {
      await weekly("Arlo", 20_000, {
        archivedAt: new Date("2026-10-20T12:00:00Z"),
      });
      await weekly("Ivy", 20_000, {
        status: DriverStatus.inactive,
        leftReason: "contract_ended" as Driver["leftReason"],
      });
      await weekly("Cole", 20_000, {
        status: DriverStatus.inactive,
        leftReason: "bad_driver" as Driver["leftReason"],
        sentToCollectionsAt: new Date("2026-10-20T12:00:00Z"),
      });
      await weekly("Olga", 20_000, { status: DriverStatus.onboarding });
      expect(await service.get(WED_630PM)).toMatchObject({
        dueToday: [],
        late: [],
        earlyWarning: [],
      });
    });

    it("lists nobody who has paid in full (the next rent is not posted yet)", async () => {
      await weekly("Paula", 40_000);
      const result = await service.get(new Date("2026-10-28T23:30:00Z")); // next Wednesday 6:30 PM, rent for the 28th not posted yet
      expect(result.late).toEqual([]);
      expect(result.earlyWarning).toEqual([]);
    });
  });
  describe("should be deactivated", () => {
    const FRI_6PM = new Date("2026-10-23T23:00:00Z"); // Friday 6:00 PM
    const FRI_559PM = new Date("2026-10-23T22:59:00Z");

    it("lists a weekly driver whose payment is 2 days late, with the reason, the balance and the days", async () => {
      // Wendy: $200 paid went to the 14th; the 21st's $200 is open. Due Wednesday 6 PM: 2 days late on Friday 6 PM.
      const wendy = await weekly("Wendy", 20_000);
      expect((await service.get(FRI_559PM)).shouldBeDeactivated).toEqual([]); // 1 day late
      const { shouldBeDeactivated, earlyWarning } = await service.get(FRI_6PM);
      expect(shouldBeDeactivated).toEqual([
        {
          driverId: wendy,
          name: "Wendy Driver",
          schedule: "weekly",
          driverStatus: "active",
          reasons: ["weekly_late"],
          balanceCents: -20_000, // $200 paid - two $200 rents
          daysLate: 2,
          depositDaysSinceDue: null,
          depositCents: null,
        },
      ]);
      // The same driver is in Early Warning too: the lists overlap on purpose (early warning comes first).
      expect(earlyWarning.map((r) => r.driverId)).toEqual([wendy]);
    });

    it("lists a daily driver with 2 late payments, not with 1", async () => {
      // Dan: no due time. The 19th was due at midnight starting the 20th, the 20th at midnight starting the 21st.
      const dan = await driver("Dan");
      await contract(dan, "daily", 5_000, "2026-10-18");
      for (const day of ["2026-10-19", "2026-10-20", TODAY])
        await rent(dan, 5_000, day);
      // Dora: the 20th (late since midnight) and the 21st (not due until the day ends) are open: one late payment.
      const dora = await driver("Dora");
      await contract(dora, "daily", 5_000, "2026-10-18");
      for (const day of ["2026-10-20", TODAY]) await rent(dora, 5_000, day);

      const { shouldBeDeactivated } = await service.get(WED_630PM);
      expect(shouldBeDeactivated).toMatchObject([
        {
          driverId: dan,
          reasons: ["daily_late"],
          balanceCents: -15_000,
          daysLate: 1,
        },
      ]);
    });

    it("does not apply the weekly rule to a daily driver: one very old unpaid day is a single late payment", async () => {
      const dave = await driver("Dave");
      await contract(dave, "daily", 5_000, "2026-10-01");
      await rent(dave, 5_000, "2026-10-01"); // 20 days late, but a single late payment
      const { shouldBeDeactivated } = await service.get(WED_630PM);
      expect(shouldBeDeactivated).toEqual([]);
    });

    it("never lists a driver on a payment plan, and lists them again when the flag is off", async () => {
      const pam = await weekly("Pam", 20_000, { onPaymentPlan: true });
      expect((await service.get(FRI_6PM)).shouldBeDeactivated).toEqual([]);
      // Still visible in the other lists.
      expect((await service.get(FRI_6PM)).late.map((r) => r.driverId)).toEqual([
        pam,
      ]);
      await db.query(
        "UPDATE drivers SET on_payment_plan = false WHERE id = $1",
        [pam],
      );
      expect(
        (await service.get(FRI_6PM)).shouldBeDeactivated.map((r) => r.driverId),
      ).toEqual([pam]);
    });

    it("lists a driver still onboarding whose deposit is unpaid 7 days after the contract start date, not 6", async () => {
      const olga = await onboarding("Olga", "2026-10-14");
      const on = async (day: string) =>
        (await service.get(new Date(`${day}T17:00:00Z`))).shouldBeDeactivated;
      expect(await on("2026-10-20")).toEqual([]); // 6 days
      expect(await on("2026-10-21")).toEqual([
        {
          driverId: olga,
          name: "Olga Driver",
          schedule: "weekly",
          driverStatus: "onboarding",
          reasons: ["deposit_unpaid"],
          balanceCents: -20_000,
          daysLate: 0,
          depositDaysSinceDue: 7,
          depositCents: 20_000,
        },
      ]);
      expect((await on("2026-10-25"))[0]).toMatchObject({
        depositDaysSinceDue: 11,
      });
    });

    it("does not list a deposit that is ticked as paid, a contract with no deposit, or a driver without a contract", async () => {
      await onboarding("Tick", "2026-10-01", {
        depositPaidAt: new Date("2026-10-02T12:00:00Z"),
      });
      await onboarding("Free", "2026-10-01", {}, 0);
      await driver("Nocontract", { status: DriverStatus.onboarding });
      expect((await service.get(WED_630PM)).shouldBeDeactivated).toEqual([]);
    });

    it("ignores unpaid rent of a driver who is not active yet (no rent rule before they are active)", async () => {
      const early = await onboarding("Early", "2026-10-19", {
        depositPaidAt: new Date("2026-10-19T12:00:00Z"),
      });
      await rent(early, 20_000, "2026-10-14"); // open and long past due, but the driver is onboarding
      expect((await service.get(WED_630PM)).shouldBeDeactivated).toEqual([]);
    });

    it("leaves out archived drivers and drivers in collections", async () => {
      await onboarding("Arlo", "2026-10-01", {
        archivedAt: new Date("2026-10-20T12:00:00Z"),
      });
      await weekly("Cole", 20_000, {
        status: DriverStatus.inactive,
        leftReason: "bad_driver" as Driver["leftReason"],
        sentToCollectionsAt: new Date("2026-10-20T12:00:00Z"),
      });
      expect((await service.get(FRI_6PM)).shouldBeDeactivated).toEqual([]);
    });

    it("puts the longest overdue first, then who owes most", async () => {
      const wendy = await weekly("Wendy", 20_000); // 2 days late on Friday 6 PM, owes $200
      const olga = await onboarding("Olga", "2026-10-14"); // deposit 9 days overdue on Friday the 23rd
      const wanda = await weekly("Wanda", 0); // nothing paid: 9 days late on the 14th's rent, owes $400
      const { shouldBeDeactivated } = await service.get(FRI_6PM);
      expect(
        shouldBeDeactivated.map((r) => [
          r.driverId,
          Math.max(r.daysLate, r.depositDaysSinceDue ?? 0),
        ]),
      ).toEqual([
        [wanda, 9],
        [olga, 9],
        [wendy, 2],
      ]);
      // Wanda and Olga tie on 9 days: the larger balance owed (Wanda, $400 against $200) comes first.
    });
  });
  describe("weekly totals", () => {
    it("adds the confirmed payments of each Monday-to-Sunday week, Chicago days, newest first", async () => {
      // 2026-10-21 is a Wednesday, so the current week is Monday 2026-10-19 to Sunday 2026-10-25 (Chicago, CDT = UTC-5).
      [{ id: payerId }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone) VALUES ('Pat', 'Payer', 'payer@test.dev', '+13125550199') RETURNING id`,
      )) as [{ id: string }];
      await payment(20_000, "2026-10-19T04:30:00Z"); // Sunday 10-18, 11:30 PM CDT: still last week
      await payment(5_000, "2026-10-14T17:00:00Z"); // Wednesday 10-14
      await payment(15_000, "2026-10-19T05:30:00Z"); // Monday 10-19, 12:30 AM CDT: the new week
      await payment(30_000, "2026-10-21T20:00:00Z"); // Wednesday 10-21, 3 PM
      await payment(10_000, "2026-10-07T15:00:00Z"); // week of 10-05
      await payment(9_999, "2026-10-21T20:00:00Z", PaymentStatus.unmatched); // not confirmed: not counted
      await payment(1_234, "2026-04-28T15:00:00Z"); // the oldest week shown, Monday 2026-04-27
      await payment(7_777, "2026-04-20T15:00:00Z"); // the week before it: not shown

      const { weeks } = await service.get(WED_630PM);
      expect(weeks).toHaveLength(26);
      expect(weeks[0]).toEqual({
        weekStart: "2026-10-19",
        weekEnd: "2026-10-25",
        totalCents: 45_000,
        paymentCount: 2,
      });
      expect(weeks[1]).toEqual({
        weekStart: "2026-10-12",
        weekEnd: "2026-10-18",
        totalCents: 25_000,
        paymentCount: 2,
      });
      expect(weeks[2]).toEqual({
        weekStart: "2026-10-05",
        weekEnd: "2026-10-11",
        totalCents: 10_000,
        paymentCount: 1,
      });
      expect(weeks[3]).toEqual({
        weekStart: "2026-09-28",
        weekEnd: "2026-10-04",
        totalCents: 0,
        paymentCount: 0,
      });
      expect(weeks[25]).toEqual({
        weekStart: "2026-04-27",
        weekEnd: "2026-05-03",
        totalCents: 1_234,
        paymentCount: 1,
      });
      // The total of the weeks shown is exactly the confirmed money inside them.
      expect(weeks.reduce((sum, w) => sum + w.totalCents, 0)).toBe(
        20_000 + 5_000 + 15_000 + 30_000 + 10_000 + 1_234,
      );
    });

    it("puts a payment into the week of its Chicago day across the daylight-saving change", async () => {
      [{ id: payerId }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone) VALUES ('Pat', 'Payer', 'payer@test.dev', '+13125550199') RETURNING id`,
      )) as [{ id: string }];
      // Clocks went back on Sunday 2026-11-01. 11:30 PM that Sunday (CST) is 05:30 UTC Monday: still the week of 10-26.
      await payment(1_000, "2026-11-02T05:30:00Z");
      await payment(2_000, "2026-11-02T06:30:00Z"); // 12:30 AM Monday 11-02 CST: the week of 11-02
      const { weeks } = await service.get(new Date("2026-11-04T18:00:00Z"));
      expect(weeks[0]).toMatchObject({
        weekStart: "2026-11-02",
        totalCents: 2_000,
      });
      expect(weeks[1]).toMatchObject({
        weekStart: "2026-10-26",
        totalCents: 1_000,
      });
    });
  });

  describe("deposits collected", () => {
    it("lists the drivers whose deposit step is ticked, newest first, and adds up the amounts typed", async () => {
      await driver("Ann", {
        depositPaidAt: new Date("2026-10-15T12:00:00Z"),
        depositPaidCents: 20_000,
      });
      const bea = await driver("Bea", {
        depositPaidAt: new Date("2026-10-17T12:00:00Z"),
        depositPaidCents: 25_000,
      });
      await driver("Cy"); // active, step ticked on 2026-09-01 with no amount recorded
      await driver("Dee", {
        depositPaidAt: new Date("2026-10-18T12:00:00Z"),
        depositPaidCents: 99_999,
        archivedAt: new Date("2026-10-19T12:00:00Z"),
      });
      await driver("Ed", { status: DriverStatus.onboarding }); // step not ticked

      const { depositsCollected } = await service.get(WED_630PM);
      expect(depositsCollected.totalCents).toBe(45_000);
      expect(depositsCollected.withoutAmountCount).toBe(1);
      expect(
        depositsCollected.drivers.map((d) => [d.name, d.amountCents]),
      ).toEqual([
        ["Bea Driver", 25_000],
        ["Ann Driver", 20_000],
        ["Cy Driver", null],
      ]);
      expect(depositsCollected.drivers[0]).toMatchObject({
        driverId: bea,
        paidAt: new Date("2026-10-17T12:00:00Z"),
      });
    });
  });

  describe("deposits pending", () => {
    it("lists contracts that ask for a deposit that is not ticked, longest overdue first, with the total", async () => {
      const olga = await onboarding("Olga", "2026-10-14"); // $200, due 7 days ago
      const nell = await onboarding("Nell", "2026-10-19", {}, 25_000); // $250, due 2 days ago
      await onboarding("Tick", "2026-10-01", {
        depositPaidAt: new Date("2026-10-02T12:00:00Z"),
      }); // ticked: not pending
      await onboarding("Free", "2026-10-01", {}, 0); // the contract has no deposit
      await driver("Nocontract", { status: DriverStatus.onboarding });
      await onboarding("Arlo", "2026-10-01", {
        archivedAt: new Date("2026-10-20T12:00:00Z"),
      }); // archived
      await onboarding("Pia", "2026-10-21", { onPaymentPlan: true }, 10_000); // due today

      const { depositsPending } = await service.get(WED_630PM);
      expect(depositsPending.totalCents).toBe(20_000 + 25_000 + 10_000);
      expect(depositsPending.drivers).toEqual([
        {
          driverId: olga,
          name: "Olga Driver",
          amountCents: 20_000,
          dueDate: "2026-10-14",
          daysSinceDue: 7,
          overdue: true,
          onPaymentPlan: false,
        },
        {
          driverId: nell,
          name: "Nell Driver",
          amountCents: 25_000,
          dueDate: "2026-10-19",
          daysSinceDue: 2,
          overdue: false,
          onPaymentPlan: false,
        },
        expect.objectContaining({
          name: "Pia Driver",
          daysSinceDue: 0,
          overdue: false,
          onPaymentPlan: true,
        }),
      ]);
    });
  });

  describe("collections", () => {
    it("lists the drivers sent to collections with what they owe, most owed first, and leaves out archived ones", async () => {
      const reason = "bad_driver" as Driver["leftReason"];
      const sent = new Date("2026-10-20T12:00:00Z");
      const cole = await driver("Cole", {
        status: DriverStatus.inactive,
        leftReason: reason,
        sentToCollectionsAt: sent,
      });
      await entry(cole, "debit", 40_000, "2026-10-14");
      await entry(cole, "credit", 10_000, "2026-10-15"); // balance -$300
      const cora = await driver("Cora", {
        status: DriverStatus.inactive,
        leftReason: reason,
        sentToCollectionsAt: sent,
      });
      await entry(cora, "debit", 70_000, "2026-10-14"); // balance -$700
      const cyd = await driver("Cyd", {
        status: DriverStatus.inactive,
        leftReason: reason,
        sentToCollectionsAt: sent,
      });
      await entry(cyd, "credit", 5_000, "2026-10-14"); // paid ahead: +$50, owes nothing
      const arch = await driver("Arch", {
        status: DriverStatus.inactive,
        leftReason: reason,
        sentToCollectionsAt: sent,
        archivedAt: sent,
      });
      await entry(arch, "debit", 90_000, "2026-10-14");
      await driver("Inactive", {
        status: DriverStatus.inactive,
        leftReason: "contract_ended" as Driver["leftReason"],
      }); // left, not in collections

      const { collections } = await service.get(WED_630PM);
      expect(collections.totalOwedCents).toBe(30_000 + 70_000);
      expect(
        collections.drivers.map((d) => [d.driverId, d.balanceCents]),
      ).toEqual([
        [cora, -70_000],
        [cole, -30_000],
        [cyd, 5_000],
      ]);
      expect(collections.drivers[0]).toMatchObject({
        sentToCollectionsAt: sent,
        leftReason: "bad_driver",
      });
    });
  });
});
