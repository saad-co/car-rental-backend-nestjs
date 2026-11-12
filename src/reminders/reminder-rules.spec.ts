import { ContractSchedule } from "../contracts/contract.entity.js";
import {
  describeDue,
  nextReminder,
  ReminderKind,
  type ReminderFacts,
} from "./reminder-rules.js";

/** A driver who is fine: nothing is late, nothing sent, nothing due. Tests override what they are about. */
const facts = (overrides: Partial<ReminderFacts> = {}): ReminderFacts => ({
  driverId: "d1",
  now: new Date("2026-11-12T15:00:00Z"),
  schedule: ContractSchedule.daily,
  rentDueTime: null,
  lateCount: 0,
  pastDueCents: 0,
  balanceCents: 0,
  episode: null,
  upcomingRemindersEnabled: true,
  balanceRemindersEnabled: true,
  upcoming: null,
  sentKeys: new Set(),
  lastChaseAt: null,
  lastPaymentAt: null,
  textedToday: false,
  latestPayment: null,
  ...overrides,
});

const EPISODE = "2026-11-10T16:00:00.000Z";
const HOUR = 3_600_000;

describe("upcoming reminder (weekly drivers, 48 hours before the due date and time)", () => {
  // A weekly rent of $350.00 due on a Sunday at 6 PM Chicago.
  const weekly = (
    dueDate: string,
    now: string,
    extra: Partial<ReminderFacts> = {},
  ) =>
    facts({
      schedule: ContractSchedule.weekly,
      rentDueTime: "18:00",
      upcoming: { dueDate, amountCents: 35_000 },
      now: new Date(now),
      ...extra,
    });

  it("an ordinary week: opens Friday 6 PM, says the due date and time and the amount, closes at the due time", () => {
    // Due Sunday 2026-11-15 18:00 CST = 2026-11-16T00:00Z. Opens Friday 2026-11-13 18:00 CST = 2026-11-14T00:00Z.
    expect(
      nextReminder(weekly("2026-11-15", "2026-11-13T23:59:59Z")),
    ).toBeNull();
    const due = nextReminder(weekly("2026-11-15", "2026-11-14T00:00:00Z"));
    expect(due).toMatchObject({
      kind: ReminderKind.upcoming,
      dedupeKey: "upcoming:d1:2026-11-15",
      values: { amount: "$350.00", due: "Sunday, Nov 15 at 6:00 PM" },
    });
    expect(
      nextReminder(weekly("2026-11-15", "2026-11-15T23:59:59Z")),
    ).not.toBeNull();
    expect(
      nextReminder(weekly("2026-11-15", "2026-11-16T00:00:00Z")),
    ).toBeNull();
  });

  it("spring-forward week (due Sunday 2026-03-08 6 PM CDT = 23:00Z): the window still opens at Friday 6 PM on the clock", () => {
    // Friday 2026-03-06 18:00 CST = 2026-03-07T00:00Z. (Two real days before the due moment would be 23:00Z: an hour early.)
    expect(
      nextReminder(weekly("2026-03-08", "2026-03-06T23:59:59Z")),
    ).toBeNull();
    expect(
      nextReminder(weekly("2026-03-08", "2026-03-07T00:00:00Z")),
    ).not.toBeNull();
    expect(
      nextReminder(weekly("2026-03-08", "2026-03-08T22:59:59Z")),
    ).not.toBeNull();
    expect(
      nextReminder(weekly("2026-03-08", "2026-03-08T23:00:00Z")),
    ).toBeNull();
  });

  it("fall-back week (due Sunday 2026-11-01 6 PM CST = 2026-11-02T00:00Z): opens Friday 6 PM CDT = 2026-10-30T23:00Z", () => {
    expect(
      nextReminder(weekly("2026-11-01", "2026-10-30T22:59:59Z")),
    ).toBeNull();
    expect(
      nextReminder(weekly("2026-11-01", "2026-10-30T23:00:00Z")),
    ).not.toBeNull();
    expect(
      nextReminder(weekly("2026-11-01", "2026-11-01T23:59:59Z")),
    ).not.toBeNull();
    expect(
      nextReminder(weekly("2026-11-01", "2026-11-02T00:00:00Z")),
    ).toBeNull();
  });

  it("a driver with no due time is due when the day ends: opens at the start of the Saturday before, says so", () => {
    // Due Sunday 2026-11-15 ends at 2026-11-16 00:00 CST = 06:00Z; opens Friday 2026-11-13 00:00... no: two days earlier, Saturday 2026-11-14 00:00 CST = 06:00Z.
    const noTime = (now: string) =>
      weekly("2026-11-15", now, { rentDueTime: null });
    expect(nextReminder(noTime("2026-11-14T05:59:59Z"))).toBeNull();
    expect(nextReminder(noTime("2026-11-14T06:00:00Z"))).toMatchObject({
      values: { due: "Sunday, Nov 15 (by the end of the day)" },
    });
    expect(nextReminder(noTime("2026-11-16T06:00:00Z"))).toBeNull();
  });

  it("is sent once, and not for a driver who switched it off, a daily driver, or one who has paid ahead", () => {
    const now = "2026-11-14T12:00:00Z";
    expect(nextReminder(weekly("2026-11-15", now))).not.toBeNull();
    expect(
      nextReminder(
        weekly("2026-11-15", now, {
          sentKeys: new Set(["upcoming:d1:2026-11-15"]),
        }),
      ),
    ).toBeNull();
    expect(
      nextReminder(
        weekly("2026-11-15", now, { upcomingRemindersEnabled: false }),
      ),
    ).toBeNull();
    expect(
      nextReminder(
        weekly("2026-11-15", now, { schedule: ContractSchedule.daily }),
      ),
    ).toBeNull();
    // $350.00 on the ledger covers the $350.00 payment; $349.99 does not.
    expect(
      nextReminder(weekly("2026-11-15", now, { balanceCents: 35_000 })),
    ).toBeNull();
    expect(
      nextReminder(weekly("2026-11-15", now, { balanceCents: 34_999 })),
    ).not.toBeNull();
  });
});

describe("late reminder (one text when a payment is missed)", () => {
  it("goes out once per stretch of being behind, with the past-due amount", () => {
    const late = facts({ lateCount: 1, pastDueCents: 7_000, episode: EPISODE });
    expect(nextReminder(late)).toMatchObject({
      kind: ReminderKind.late,
      dedupeKey: `late:d1:${EPISODE}`,
      values: { balance: "$70.00" },
    });
    expect(
      nextReminder({ ...late, sentKeys: new Set([`late:d1:${EPISODE}`]) }),
    ).toBeNull();
    // Paid up and behind again later: a new stretch, a new key, a new text.
    expect(
      nextReminder({
        ...late,
        episode: "2026-11-12T01:00:00.000Z",
        sentKeys: new Set([`late:d1:${EPISODE}`]),
      }),
    ).toMatchObject({ kind: ReminderKind.late });
  });

  it("is not sent after a high-balance text in the same stretch: the driver was already told once", () => {
    const told = facts({
      schedule: ContractSchedule.daily,
      lateCount: 6,
      pastDueCents: 42_000,
      episode: EPISODE,
      balanceRemindersEnabled: false,
      sentKeys: new Set([`high_balance:d1:3:${EPISODE}`]),
    });
    expect(nextReminder(told)).toBeNull();
  });

  it("is not sent to a driver who is not behind", () => {
    expect(nextReminder(facts({ lateCount: 0, episode: null }))).toBeNull();
  });
});

describe("high balance reminder (daily drivers at 2, 3, 4 and 5 payments behind)", () => {
  // A $70 daily rent: n payments behind owe n x $70.
  const behind = (n: number, extra: Partial<ReminderFacts> = {}) =>
    facts({
      lateCount: n,
      pastDueCents: 7_000 * n,
      episode: EPISODE,
      sentKeys: new Set([`late:d1:${EPISODE}`]),
      ...extra,
    });

  it.each([
    [2, "$140.00"],
    [3, "$210.00"],
    [4, "$280.00"],
    [5, "$350.00"],
  ])("at %i behind it says so and the balance %s", (n, balance) => {
    expect(nextReminder(behind(n))).toMatchObject({
      kind: ReminderKind.high_balance,
      tier: n,
      dedupeKey: `high_balance:d1:${n}:${EPISODE}`,
      values: { missedCount: String(n), balance },
    });
  });

  it("each threshold sends once; a driver who jumped to 4 gets the 4 text, not three texts", () => {
    // The tier-3 text went out an hour ago: nothing high-balance is left to send (the 3-day balance clock has just
    // started from that text, so no balance reminder either).
    expect(
      nextReminder(
        behind(3, {
          sentKeys: new Set([
            `late:d1:${EPISODE}`,
            `high_balance:d1:3:${EPISODE}`,
          ]),
          lastChaseAt: new Date("2026-11-12T14:00:00Z"),
        }),
      ),
    ).toBeNull();
    expect(nextReminder(behind(4))).toMatchObject({ tier: 4 });
  });

  it("is only for daily drivers, and stops after 5 (the balance reminders carry on)", () => {
    expect(
      nextReminder(
        behind(2, {
          schedule: ContractSchedule.weekly,
          balanceRemindersEnabled: false,
        }),
      ),
    ).toBeNull();
    // 6 behind = $420.00 past due: no tier 6, the balance reminder takes over (never texted by it before).
    expect(nextReminder(behind(6))).toMatchObject({
      kind: ReminderKind.balance,
    });
    expect(nextReminder(behind(1))).toBeNull();
  });
});

describe("balance reminder (past due over $100, every 3 days, any payment resets the clock)", () => {
  const owing = (cents: number, extra: Partial<ReminderFacts> = {}) =>
    facts({
      schedule: ContractSchedule.weekly,
      lateCount: 1,
      pastDueCents: cents,
      episode: EPISODE,
      sentKeys: new Set([`late:d1:${EPISODE}`]),
      ...extra,
    });
  const now = new Date("2026-11-12T15:00:00Z");

  it("needs MORE than $100.00: $100.00 is not enough, $100.01 is", () => {
    expect(nextReminder(owing(10_000))).toBeNull();
    expect(nextReminder(owing(10_001))).toMatchObject({
      kind: ReminderKind.balance,
      values: { balance: "$100.01" },
    });
  });

  it("repeats every 72 hours from the last reminder about the balance", () => {
    const sentAt = (hoursAgo: number) =>
      new Date(now.getTime() - hoursAgo * HOUR);
    expect(
      nextReminder(owing(20_000, { lastChaseAt: sentAt(71.9) })),
    ).toBeNull();
    expect(
      nextReminder(owing(20_000, { lastChaseAt: sentAt(72) })),
    ).toMatchObject({
      kind: ReminderKind.balance,
    });
  });

  it("a payment resets the clock, even a small one, and a reminder resets it too", () => {
    const sentAt = (hoursAgo: number) =>
      new Date(now.getTime() - hoursAgo * HOUR);
    // Last reminder 100 hours ago, but a payment 2 hours ago: not due for another 70 hours.
    expect(
      nextReminder(
        owing(20_000, { lastChaseAt: sentAt(100), lastPaymentAt: sentAt(2) }),
      ),
    ).toBeNull();
    expect(
      nextReminder(
        owing(20_000, { lastChaseAt: sentAt(100), lastPaymentAt: sentAt(73) }),
      ),
    ).toMatchObject({ kind: ReminderKind.balance });
  });

  it("staff can switch it off for a driver", () => {
    expect(
      nextReminder(owing(20_000, { balanceRemindersEnabled: false })),
    ).toBeNull();
  });

  it("works for a driver who is a week behind with no due time in the contract, and never sends the same day twice", () => {
    const first = nextReminder(owing(20_000));
    expect(first?.dedupeKey).toBe("balance:d1:2026-11-12");
    expect(
      nextReminder(
        owing(20_000, {
          sentKeys: new Set(["balance:d1:2026-11-12", `late:d1:${EPISODE}`]),
        }),
      ),
    ).toBeNull();
  });
});

describe("one text a day, and the confirmation after a payment", () => {
  const dailyFourBehind = facts({
    lateCount: 4,
    pastDueCents: 28_000,
    episode: EPISODE,
    sentKeys: new Set([`late:d1:${EPISODE}`]),
  });

  it("a high balance reminder and a balance reminder due the same day: only the high balance one goes", () => {
    const due = nextReminder(dailyFourBehind);
    expect(due?.kind).toBe(ReminderKind.high_balance);
  });

  it("anything already sent today holds every other reminder back", () => {
    expect(nextReminder({ ...dailyFourBehind, textedToday: true })).toBeNull();
  });

  it("after a payment, a short confirmation with what is still past due; it is not held back by an earlier text today", () => {
    const paid = {
      ...dailyFourBehind,
      textedToday: true,
      pastDueCents: 14_000,
      latestPayment: { entryId: "e1", at: new Date("2026-11-12T14:50:00Z") },
    };
    expect(nextReminder(paid)).toMatchObject({
      kind: ReminderKind.payment_received,
      dedupeKey: "received:e1",
      values: { balance: "$140.00" },
    });
    // Once, and only while something is still past due.
    expect(
      nextReminder({ ...paid, sentKeys: new Set(["received:e1"]) }),
    ).toBeNull();
    expect(
      nextReminder({ ...paid, pastDueCents: 0, lateCount: 0, episode: null }),
    ).toBeNull();
  });
});

describe("describeDue", () => {
  it("writes the weekday, the date and a 12-hour clock", () => {
    expect(describeDue("2026-11-15", "18:00")).toBe(
      "Sunday, Nov 15 at 6:00 PM",
    );
    expect(describeDue("2026-11-16", "00:30")).toBe(
      "Monday, Nov 16 at 12:30 AM",
    );
    expect(describeDue("2026-11-17", "12:00")).toBe(
      "Tuesday, Nov 17 at 12:00 PM",
    );
    expect(describeDue("2026-11-18", null)).toBe(
      "Wednesday, Nov 18 (by the end of the day)",
    );
  });
});
