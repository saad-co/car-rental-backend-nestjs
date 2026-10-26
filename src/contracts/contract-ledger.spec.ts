import { LedgerEntryKind } from "../ledger/ledger-entry.entity.js";
import {
  notPostedAutomatically,
  pickupEntries,
  rentDebit,
  rentDueDates,
  rentKey,
  rentSchedule,
  type BillableContract,
  type ContractForLedger,
} from "./contract-ledger.js";
import { ContractSchedule } from "./contract.entity.js";

/** The Ashwood sample: weekly $409 from Tuesday 2026-10-13, deposit $200, nothing else. */
const ashwood: ContractForLedger = {
  id: "c-1",
  driverId: "d-1",
  schedule: ContractSchedule.weekly,
  totalRateCents: 40_900,
  startDate: "2026-10-13",
  termMonths: 18,
  securityDepositCents: 20_000,
  documentationFeeCents: 0,
  insuranceStartFeeCents: 0,
  otherOneTimeCents: 0,
  holdVehicleCents: 0,
  excessMileageCents: 0,
  insuranceExcessCents: 0,
  otherRecurringCents: 0,
};

describe("pickupEntries (what signing puts on the ledger, D83)", () => {
  it("gives the deposit and the first rent for the Ashwood sample ($200.00 and $409.00)", () => {
    expect(pickupEntries(ashwood)).toEqual([
      {
        key: "contract:c-1:security_deposit",
        amountCents: 20_000,
        kind: LedgerEntryKind.contract_charge,
        description:
          "Security deposit (refundable), contract of October 13, 2026",
        effectiveDate: "2026-10-13",
      },
      {
        key: "rent:d-1:2026-10-13",
        amountCents: 40_900,
        kind: LedgerEntryKind.rent,
        description: "Weekly rent, due October 13, 2026",
        effectiveDate: "2026-10-13",
      },
    ]);
  });

  it("adds up to the amount due at pickup", () => {
    const total = pickupEntries(ashwood).reduce(
      (sum, e) => sum + e.amountCents,
      0,
    );
    expect(total).toBe(60_900);
  });

  it("gives the daily Evergreen sample: deposit $300.00 and daily rent $61.00", () => {
    const entries = pickupEntries({
      ...ashwood,
      schedule: ContractSchedule.daily,
      totalRateCents: 6_100,
      securityDepositCents: 30_000,
    });
    expect(entries.map((e) => [e.amountCents, e.kind])).toEqual([
      [30_000, LedgerEntryKind.contract_charge],
      [6_100, LedgerEntryKind.rent],
    ]);
    expect(entries[1].description).toBe("Daily rent, October 13, 2026");
  });

  it("posts one entry per non-zero charge, in the contract order, and skips the zero ones", () => {
    const entries = pickupEntries({
      ...ashwood,
      securityDepositCents: 0,
      documentationFeeCents: 15_000,
      insuranceStartFeeCents: 25_000,
      otherOneTimeCents: 1_000,
      holdVehicleCents: 5_000,
    });
    expect(entries.map((e) => e.key)).toEqual([
      "contract:c-1:documentation_fee",
      "contract:c-1:insurance_start_fee",
      "contract:c-1:other_one_time",
      "contract:c-1:hold_vehicle",
      "rent:d-1:2026-10-13",
    ]);
    expect(entries.map((e) => e.description.split(",")[0])).toEqual([
      "Documentation fee",
      "Insurance policy start fee",
      "Other one-time charge",
      "Hold vehicle payment",
      "Weekly rent",
    ]);
  });

  it("gives only the first rent when there are no one-time charges", () => {
    expect(
      pickupEntries({ ...ashwood, securityDepositCents: 0 }).map((e) => e.key),
    ).toEqual(["rent:d-1:2026-10-13"]);
  });

  it("never posts the recurring extras (mileage, insurance excess, other recurring)", () => {
    const keys = pickupEntries({
      ...ashwood,
      excessMileageCents: 25,
      insuranceExcessCents: 5_000,
      otherRecurringCents: 1_000,
    }).map((e) => e.key);
    expect(keys).toEqual([
      "contract:c-1:security_deposit",
      "rent:d-1:2026-10-13",
    ]);
  });

  it("dates every entry with the start date, whatever day it is signed", () => {
    expect(new Set(pickupEntries(ashwood).map((e) => e.effectiveDate))).toEqual(
      new Set(["2026-10-13"]),
    );
  });
});

describe("rentDebit and rentKey", () => {
  it("uses the same key format for the first rent and the job rent, so one due date posts once", () => {
    expect(rentKey("d-1", "2026-10-20")).toBe("rent:d-1:2026-10-20");
    expect(rentDebit(ashwood, "2026-10-20").key).toBe(
      pickupEntries({ ...ashwood, startDate: "2026-10-20" }).at(-1)?.key,
    );
  });

  it("is a rent debit of the contract payment dated the due day", () => {
    expect(rentDebit(ashwood, "2026-10-20")).toEqual({
      key: "rent:d-1:2026-10-20",
      amountCents: 40_900,
      kind: LedgerEntryKind.rent,
      description: "Weekly rent, due October 20, 2026",
      effectiveDate: "2026-10-20",
    });
  });
});

describe("rentDueDates (the rent job dates)", () => {
  const weekly = ContractSchedule.weekly;
  const daily = ContractSchedule.daily;

  it("weekly from Tuesday 2026-10-13: every 7 days after the start, up to and including today", () => {
    expect(
      rentDueDates("2026-10-13", weekly, "2026-10-13", "2026-10-27"),
    ).toEqual(["2026-10-20", "2026-10-27"]);
  });

  it("does not include a due date that has not come yet, or the start date itself", () => {
    expect(
      rentDueDates("2026-10-13", weekly, "2026-10-13", "2026-10-26"),
    ).toEqual(["2026-10-20"]);
    expect(
      rentDueDates("2026-10-13", weekly, "2026-10-13", "2026-10-19"),
    ).toEqual([]);
    expect(
      rentDueDates("2026-10-13", weekly, "2026-10-13", "2026-10-13"),
    ).toEqual([]);
  });

  it("daily: every day after the start", () => {
    expect(
      rentDueDates("2026-10-13", daily, "2026-10-13", "2026-10-16"),
    ).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
  });

  it("never goes before `from`: a driver who became active later is not billed for earlier dates", () => {
    expect(
      rentDueDates("2026-10-13", weekly, "2026-10-21", "2026-11-03"),
    ).toEqual(["2026-10-27", "2026-11-03"]);
    expect(
      rentDueDates("2026-10-13", daily, "2026-10-20", "2026-10-22"),
    ).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
  });

  it("includes a due date that falls exactly on `from`", () => {
    expect(
      rentDueDates("2026-10-13", weekly, "2026-10-20", "2026-10-27"),
    ).toEqual(["2026-10-20", "2026-10-27"]);
  });

  it("a `from` before the start still starts one period after the start", () => {
    expect(
      rentDueDates("2026-10-13", weekly, "2026-10-01", "2026-10-20"),
    ).toEqual(["2026-10-20"]);
  });

  it("is empty when `from` is after today", () => {
    expect(
      rentDueDates("2026-10-13", weekly, "2026-12-01", "2026-10-27"),
    ).toEqual([]);
  });

  it("crosses month and year boundaries", () => {
    expect(
      rentDueDates("2026-12-30", weekly, "2026-12-30", "2027-01-13"),
    ).toEqual(["2027-01-06", "2027-01-13"]);
    expect(
      rentDueDates("2026-01-30", daily, "2026-01-30", "2026-02-02"),
    ).toEqual(["2026-01-31", "2026-02-01", "2026-02-02"]);
  });

  it("does not stop at the end of the lease: the contract auto-extends", () => {
    // 18 months after 2026-10-13 ends on 2028-04-13; rent continues past it.
    const dates = rentDueDates(
      "2026-10-13",
      weekly,
      "2026-10-13",
      "2028-05-01",
    );
    expect(dates.at(-1)).toBe("2028-04-25");
    expect(dates.every((day) => day > "2026-10-13")).toBe(true);
  });

  it("keeps the weekday of the start date", () => {
    for (const day of rentDueDates(
      "2026-10-13",
      weekly,
      "2026-10-13",
      "2027-03-01",
    )) {
      expect(new Date(`${day}T12:00:00Z`).getUTCDay()).toBe(2); // Tuesday
    }
  });
});

describe("notPostedAutomatically", () => {
  it("is empty when every recurring extra is zero", () => {
    expect(notPostedAutomatically(ashwood)).toEqual([]);
  });

  it("lists only the non-zero ones", () => {
    expect(
      notPostedAutomatically({ ...ashwood, excessMileageCents: 25 }),
    ).toEqual(["Excess mileage per mile"]);
    expect(
      notPostedAutomatically({
        ...ashwood,
        excessMileageCents: 25,
        insuranceExcessCents: 5_000,
        otherRecurringCents: 1_000,
      }),
    ).toEqual([
      "Excess mileage per mile",
      "Insurance excess per month",
      "Other recurring charge",
    ]);
  });
});

describe("rentSchedule (which contract bills each due date)", () => {
  const first: BillableContract = {
    driverId: "d-1",
    schedule: ContractSchedule.weekly,
    totalRateCents: 40_900,
    startDate: "2026-10-13",
    signedAt: new Date("2026-10-12T15:00:00Z"),
  };
  const days = (debits: { effectiveDate: string }[]) =>
    debits.map((d) => d.effectiveDate);

  it("one contract: its due dates, at its rate", () => {
    const debits = rentSchedule([first], "2026-10-13", "2026-10-27");
    expect(days(debits)).toEqual(["2026-10-20", "2026-10-27"]);
    expect(debits.every((d) => d.amountCents === 40_900)).toBe(true);
  });

  it("no contracts: nothing", () => {
    expect(rentSchedule([], "2026-10-13", "2026-10-27")).toEqual([]);
  });

  it("a newer contract takes over on its own start date, with no gap and no overlap", () => {
    const second: BillableContract = {
      ...first,
      totalRateCents: 50_000,
      schedule: ContractSchedule.daily,
      startDate: "2026-11-04",
      signedAt: new Date("2026-10-30T15:00:00Z"),
    };
    const debits = rentSchedule([second, first], "2026-10-13", "2026-11-06");
    // The old contract bills 10-20, 10-27 and 11-03 (the day before the new start); the new one 11-05 and 11-06.
    // The new contract's first rent (11-04) is posted when it is signed, not here.
    expect(debits.map((d) => [d.effectiveDate, d.amountCents])).toEqual([
      ["2026-10-20", 40_900],
      ["2026-10-27", 40_900],
      ["2026-11-03", 40_900],
      ["2026-11-05", 50_000],
      ["2026-11-06", 50_000],
    ]);
  });

  it("a newer contract that has not started yet leaves the old one billing until its start", () => {
    const future: BillableContract = {
      ...first,
      totalRateCents: 50_000,
      startDate: "2026-12-01",
      signedAt: new Date("2026-10-30T15:00:00Z"),
    };
    const debits = rentSchedule([first, future], "2026-10-13", "2026-11-10");
    expect(days(debits)).toEqual([
      "2026-10-20",
      "2026-10-27",
      "2026-11-03",
      "2026-11-10",
    ]);
    expect(debits.every((d) => d.amountCents === 40_900)).toBe(true);
  });

  it("two contracts with the same start date: the one signed last bills, once", () => {
    const later: BillableContract = {
      ...first,
      totalRateCents: 45_000,
      signedAt: new Date("2026-10-14T15:00:00Z"),
    };
    const debits = rentSchedule([later, first], "2026-10-13", "2026-10-27");
    expect(days(debits)).toEqual(["2026-10-20", "2026-10-27"]);
    expect(debits.every((d) => d.amountCents === 45_000)).toBe(true);
  });

  it("respects `from`: nothing before it", () => {
    expect(days(rentSchedule([first], "2026-10-21", "2026-11-03"))).toEqual([
      "2026-10-27",
      "2026-11-03",
    ]);
  });
});
