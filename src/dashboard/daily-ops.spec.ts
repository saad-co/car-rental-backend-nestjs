import { describe, expect, it } from "vitest";
import { ContractSchedule } from "../contracts/contract.entity.js";
import {
  LedgerDirection,
  LedgerEntryKind,
} from "../ledger/ledger-entry.entity.js";
import {
  deactivationReasons,
  depositStatus,
  dueMoment,
  dueStatus,
  isEarlyWarning,
  isLate,
  minuteTime,
  openCharges,
  rentLateness,
  type LedgerLine,
  type OpenCharge,
} from "./daily-ops.js";

// Every instant below is written in UTC next to its Chicago meaning. In October Chicago is on CDT (UTC-5): 6 PM = 23:00Z.
// 2026-10-21 is a Wednesday.

const debit = (
  id: string,
  cents: number,
  effectiveDate: string,
  kind: LedgerEntryKind = LedgerEntryKind.rent,
): LedgerLine => ({
  id,
  direction: LedgerDirection.debit,
  kind,
  amountCents: cents,
  effectiveDate,
});
const credit = (
  id: string,
  cents: number,
  effectiveDate: string,
): LedgerLine => ({
  id,
  direction: LedgerDirection.credit,
  kind: LedgerEntryKind.payment,
  amountCents: cents,
  effectiveDate,
});
const open = (
  cents: number,
  effectiveDate: string,
  openCents = cents,
): OpenCharge => ({
  id: `rent-${effectiveDate}`,
  kind: LedgerEntryKind.rent,
  effectiveDate,
  amountCents: cents,
  openCents,
});
const at = (iso: string) => new Date(iso);

describe("openCharges (oldest first)", () => {
  it("is empty without debits, and paying ahead leaves nothing to list", () => {
    expect(openCharges([])).toEqual([]);
    expect(openCharges([credit("p1", 50_000, "2026-10-21")])).toEqual([]);
  });

  it("leaves a charge fully open when nothing was paid", () => {
    expect(openCharges([debit("r1", 20_000, "2026-10-21")])).toMatchObject([
      { id: "r1", amountCents: 20_000, openCents: 20_000 },
    ]);
  });

  it("pays the oldest charge first: $250 against two $200 rents clears the first and $150 stays on the second", () => {
    const result = openCharges([
      debit("r1", 20_000, "2026-10-14"),
      debit("r2", 20_000, "2026-10-21"),
      credit("p1", 25_000, "2026-10-21"),
    ]);
    expect(result.map((c) => [c.id, c.openCents])).toEqual([
      ["r1", 0],
      ["r2", 15_000],
    ]);
  });

  it("pays the deposit and fee posted at signing before the first rent (all dated the same day, in the order recorded)", () => {
    const lines = [
      debit("dep", 20_000, "2026-10-14", LedgerEntryKind.contract_charge),
      debit("fee", 5_000, "2026-10-14", LedgerEntryKind.contract_charge),
      debit("r1", 20_000, "2026-10-14"),
    ];
    // $450 pays everything; $300 pays deposit and fee and leaves $150 of the rent open.
    expect(
      openCharges([...lines, credit("p", 45_000, "2026-10-14")]).map(
        (c) => c.openCents,
      ),
    ).toEqual([0, 0, 0]);
    expect(
      openCharges([...lines, credit("p", 30_000, "2026-10-14")]).map(
        (c) => c.openCents,
      ),
    ).toEqual([0, 0, 15_000]);
  });

  it("adds several credits into one pool", () => {
    const result = openCharges([
      debit("r1", 20_000, "2026-10-14"),
      credit("p1", 5_000, "2026-10-15"),
      credit("p2", 7_000, "2026-10-16"),
    ]);
    expect(result[0].openCents).toBe(8_000);
  });
});

describe("dueMoment", () => {
  it("is the due date at the driver's time, Chicago clock", () => {
    expect(dueMoment("2026-10-21", "18:00").toISOString()).toBe(
      "2026-10-21T23:00:00.000Z",
    );
    expect(dueMoment("2026-10-21", "12:00").toISOString()).toBe(
      "2026-10-21T17:00:00.000Z",
    );
    expect(dueMoment("2026-10-21", "20:30").toISOString()).toBe(
      "2026-10-22T01:30:00.000Z",
    );
  });

  it("is when the due day ends when no time is set", () => {
    expect(dueMoment("2026-10-21", null).toISOString()).toBe(
      "2026-10-22T05:00:00.000Z",
    );
  });

  it("can look some days past the due date, on the same Chicago clock time", () => {
    expect(dueMoment("2026-10-21", "18:00", 1).toISOString()).toBe(
      "2026-10-22T23:00:00.000Z",
    );
    expect(dueMoment("2026-10-21", null, 1).toISOString()).toBe(
      "2026-10-23T05:00:00.000Z",
    );
  });
});

describe("minuteTime", () => {
  it("cuts a Postgres time to HH:MM and keeps null", () => {
    expect(minuteTime("18:00:00")).toBe("18:00");
    expect(minuteTime("18:00")).toBe("18:00");
    expect(minuteTime(null)).toBeNull();
  });
});

describe("rentLateness: a weekly $200 rent due Wednesday 2026-10-21 at 6 PM", () => {
  const rent = [open(20_000, "2026-10-21")];
  const lateness = (now: string) => rentLateness(rent, "18:00", at(now));

  it("is not late before the due time, nor at exactly the due time", () => {
    expect(isLate(lateness("2026-10-21T22:00:00Z"))).toBe(false); // 5:00 PM
    expect(isLate(lateness("2026-10-21T23:00:00Z"))).toBe(false); // 6:00 PM sharp
  });

  it("is late from one minute after the due time, 0 days, and is not yet Early Warning", () => {
    const result = lateness("2026-10-21T23:01:00Z"); // 6:01 PM
    expect(isLate(result)).toBe(true);
    expect(result.pastDueCents).toBe(20_000);
    expect(result.oldest).toMatchObject({ hoursLate: 0, daysLate: 0 });
    expect(isEarlyWarning(result)).toBe(false);
  });

  it("is Early Warning at the same time on Thursday, not a minute before (the client's example)", () => {
    const before = lateness("2026-10-22T22:59:00Z"); // Thursday 5:59 PM
    expect(before.oldest).toMatchObject({ hoursLate: 23, daysLate: 0 });
    expect(isEarlyWarning(before)).toBe(false);
    const sharp = lateness("2026-10-22T23:00:00Z"); // Thursday 6:00 PM
    expect(sharp.oldest).toMatchObject({ hoursLate: 24, daysLate: 1 });
    expect(isEarlyWarning(sharp)).toBe(true);
  });

  it("is 2 days late on Friday 6 PM", () => {
    expect(lateness("2026-10-23T23:00:00Z").oldest?.daysLate).toBe(2);
    expect(lateness("2026-10-23T22:59:00Z").oldest?.daysLate).toBe(1);
  });

  it("counts only what is still open: $50 paid leaves $150 past due, all paid leaves nothing", () => {
    const partial = rentLateness(
      [open(20_000, "2026-10-21", 15_000)],
      "18:00",
      at("2026-10-21T23:30:00Z"),
    );
    expect(partial.pastDueCents).toBe(15_000);
    const paid = rentLateness(
      [open(20_000, "2026-10-21", 0)],
      "18:00",
      at("2026-10-25T00:00:00Z"),
    );
    expect(isLate(paid)).toBe(false);
    expect(paid.oldest).toBeNull();
  });

  it("lists late charges oldest first and takes the days late from the oldest", () => {
    const result = rentLateness(
      [open(5_000, "2026-10-21"), open(5_000, "2026-10-19")],
      "18:00",
      at("2026-10-22T23:00:00Z"), // Thursday 6 PM
    );
    expect(result.lateCharges.map((c) => [c.dueDate, c.daysLate])).toEqual([
      ["2026-10-19", 3],
      ["2026-10-21", 1],
    ]);
    expect(result.pastDueCents).toBe(10_000);
    expect(result.oldest?.dueDate).toBe("2026-10-19");
  });

  it("is not about a deposit or a fee: only rent charges count", () => {
    const deposit: OpenCharge = {
      ...open(20_000, "2026-10-01"),
      kind: LedgerEntryKind.contract_charge,
    };
    expect(
      isLate(rentLateness([deposit], "18:00", at("2026-10-22T23:00:00Z"))),
    ).toBe(false);
  });
});

describe("rentLateness: no due time set (late when the due day ends)", () => {
  it("a payment due on the 21st is not late during the 21st, is late from the start of the 22nd", () => {
    const rent = [open(5_000, "2026-10-21")];
    expect(isLate(rentLateness(rent, null, at("2026-10-22T04:59:00Z")))).toBe(
      false,
    ); // 11:59 PM on the 21st
    const late = rentLateness(rent, null, at("2026-10-22T05:01:00Z")); // 12:01 AM on the 22nd
    expect(isLate(late)).toBe(true);
    expect(late.oldest?.daysLate).toBe(0);
    expect(
      rentLateness(rent, null, at("2026-10-23T05:00:00Z")).oldest?.daysLate,
    ).toBe(1);
  });
});

describe("rentLateness across daylight saving (days are counted on the Chicago clock)", () => {
  it("spring forward: due Saturday 2026-03-07 6 PM, it is a day late on Sunday 6 PM although only 23 real hours passed", () => {
    const rent = [open(20_000, "2026-03-07")];
    const sunday1759 = rentLateness(rent, "18:00", at("2026-03-08T22:59:00Z")); // 5:59 PM CDT
    expect(sunday1759.oldest).toMatchObject({ hoursLate: 22, daysLate: 0 });
    const sunday1800 = rentLateness(rent, "18:00", at("2026-03-08T23:00:00Z")); // 6:00 PM CDT
    expect(sunday1800.oldest).toMatchObject({ hoursLate: 23, daysLate: 1 });
    expect(isEarlyWarning(sunday1800)).toBe(true);
  });

  it("fall back: due Saturday 2026-10-31 6 PM, it is a day late on Sunday 6 PM although 25 real hours passed, and not at 24 real hours", () => {
    const rent = [open(20_000, "2026-10-31")];
    const at1730 = rentLateness(rent, "18:00", at("2026-11-01T23:30:00Z")); // 5:30 PM CST, 24.5 real hours
    expect(at1730.oldest).toMatchObject({ hoursLate: 24, daysLate: 0 });
    expect(isEarlyWarning(at1730)).toBe(false);
    const at1800 = rentLateness(rent, "18:00", at("2026-11-02T00:00:00Z")); // 6:00 PM CST, 25 real hours
    expect(at1800.oldest).toMatchObject({ hoursLate: 25, daysLate: 1 });
  });
});

describe("dueStatus", () => {
  const due = open(20_000, "2026-10-21");
  it("is Not yet paid before the due time, Late after it, Paid once nothing is open", () => {
    expect(dueStatus(due, "18:00", at("2026-10-21T22:00:00Z"))).toBe(
      "not_yet_paid",
    );
    expect(dueStatus(due, "18:00", at("2026-10-21T23:00:00Z"))).toBe(
      "not_yet_paid",
    );
    expect(dueStatus(due, "18:00", at("2026-10-21T23:01:00Z"))).toBe("late");
    expect(
      dueStatus({ ...due, openCents: 0 }, "18:00", at("2026-10-22T23:01:00Z")),
    ).toBe("paid");
    expect(
      dueStatus(
        { ...due, openCents: 100 },
        "18:00",
        at("2026-10-21T23:01:00Z"),
      ),
    ).toBe("late");
  });
  it("without a due time it is Not yet paid all day", () => {
    expect(dueStatus(due, null, at("2026-10-22T04:59:00Z"))).toBe(
      "not_yet_paid",
    );
    expect(dueStatus(due, null, at("2026-10-22T05:01:00Z"))).toBe("late");
  });
});

describe("depositStatus (due on the contract start date)", () => {
  const deposit = {
    depositCents: 20_000,
    ticked: false,
    startDate: "2026-10-14",
  };
  it("is null when there is no deposit or the step is ticked", () => {
    expect(
      depositStatus({ ...deposit, depositCents: 0 }, "2026-11-11"),
    ).toBeNull();
    expect(
      depositStatus({ ...deposit, ticked: true }, "2026-11-11"),
    ).toBeNull();
  });
  it("is overdue from 7 days after the start date, not 6", () => {
    expect(depositStatus(deposit, "2026-10-20")).toEqual({
      daysSinceDue: 6,
      overdue: false,
    });
    expect(depositStatus(deposit, "2026-10-21")).toEqual({
      daysSinceDue: 7,
      overdue: true,
    });
  });
  it("is not due yet before the start date (negative days)", () => {
    expect(depositStatus(deposit, "2026-10-10")).toEqual({
      daysSinceDue: -4,
      overdue: false,
    });
  });
});

describe("deactivationReasons", () => {
  const oneLate = rentLateness(
    [open(5_000, "2026-10-21")],
    "18:00",
    at("2026-10-21T23:30:00Z"),
  );
  const twoLate = rentLateness(
    [open(5_000, "2026-10-20"), open(5_000, "2026-10-21")],
    "18:00",
    at("2026-10-21T23:30:00Z"),
  );
  const weeklyOneDay = rentLateness(
    [open(20_000, "2026-10-21")],
    "18:00",
    at("2026-10-22T23:00:00Z"),
  );
  const weeklyTwoDays = rentLateness(
    [open(20_000, "2026-10-21")],
    "18:00",
    at("2026-10-23T23:00:00Z"),
  );
  const none = rentLateness([], "18:00", at("2026-10-23T23:00:00Z"));
  const overdue = { daysSinceDue: 8, overdue: true };
  const reasons = (input: Partial<Parameters<typeof deactivationReasons>[0]>) =>
    deactivationReasons({
      schedule: ContractSchedule.weekly,
      lateness: none,
      deposit: null,
      onPaymentPlan: false,
      ...input,
    });

  it("daily driver: one late payment is not enough, two are", () => {
    expect(
      reasons({ schedule: ContractSchedule.daily, lateness: oneLate }),
    ).toEqual([]);
    expect(
      reasons({ schedule: ContractSchedule.daily, lateness: twoLate }),
    ).toEqual(["daily_late"]);
  });

  it("weekly driver: a payment 1 day late is not enough, 2 days late is", () => {
    expect(reasons({ lateness: weeklyOneDay })).toEqual([]);
    expect(reasons({ lateness: weeklyTwoDays })).toEqual(["weekly_late"]);
  });

  it("the daily rule does not apply to a weekly driver, nor the weekly rule to a daily one", () => {
    expect(
      reasons({ schedule: ContractSchedule.weekly, lateness: twoLate }),
    ).toEqual([]);
    expect(
      reasons({ schedule: ContractSchedule.daily, lateness: weeklyTwoDays }),
    ).toEqual([]);
  });

  it("an overdue deposit is a reason on its own, also for a driver with no contract schedule, and can add to a rent reason", () => {
    expect(reasons({ deposit: overdue })).toEqual(["deposit_unpaid"]);
    expect(reasons({ schedule: null, deposit: overdue })).toEqual([
      "deposit_unpaid",
    ]);
    expect(reasons({ lateness: weeklyTwoDays, deposit: overdue })).toEqual([
      "weekly_late",
      "deposit_unpaid",
    ]);
    expect(reasons({ deposit: { daysSinceDue: 3, overdue: false } })).toEqual(
      [],
    );
  });

  it("a driver on a payment plan is never listed, whatever the reason", () => {
    expect(
      reasons({
        lateness: weeklyTwoDays,
        deposit: overdue,
        onPaymentPlan: true,
      }),
    ).toEqual([]);
    expect(
      reasons({
        schedule: ContractSchedule.daily,
        lateness: twoLate,
        onPaymentPlan: true,
      }),
    ).toEqual([]);
  });
});
