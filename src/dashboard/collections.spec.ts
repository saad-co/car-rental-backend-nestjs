import { describe, expect, it } from "vitest";
import {
  periodCount,
  periodEnd,
  periodStart,
  periodStartsOnPage,
  shiftPeriod,
} from "./collections.js";

// Days are Chicago calendar days. 2026-11-09 is a Monday. 2026-03-08 and 2026-11-01 are the two Sundays on which the
// clocks change: periods are whole days, so they must be 7 days long on those weeks too.

describe("periodStart", () => {
  it("a day is its own period", () => {
    expect(periodStart("daily", "2026-11-11")).toBe("2026-11-11");
  });

  it("a month starts on the 1st, on its last day too", () => {
    expect(periodStart("monthly", "2026-11-11")).toBe("2026-11-01");
    expect(periodStart("monthly", "2026-11-30")).toBe("2026-11-01");
    expect(periodStart("monthly", "2026-11-01")).toBe("2026-11-01");
  });

  it("a week starts on Monday: Wednesday, Monday itself and Sunday all give that Monday", () => {
    expect(periodStart("weekly", "2026-11-11")).toBe("2026-11-09"); // Wednesday
    expect(periodStart("weekly", "2026-11-09")).toBe("2026-11-09"); // Monday
    expect(periodStart("weekly", "2026-11-15")).toBe("2026-11-09"); // Sunday
  });

  it("a week crossing a month or a year starts in the earlier one", () => {
    expect(periodStart("weekly", "2026-12-01")).toBe("2026-11-30"); // Tuesday
    expect(periodStart("weekly", "2027-01-01")).toBe("2026-12-28"); // Friday
  });

  it("the daylight-saving Sundays belong to the week that started the Monday before", () => {
    expect(periodStart("weekly", "2026-03-08")).toBe("2026-03-02");
    expect(periodStart("weekly", "2026-11-01")).toBe("2026-10-26");
  });
});

describe("shiftPeriod", () => {
  it("moves months across a year boundary", () => {
    expect(shiftPeriod("monthly", "2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftPeriod("monthly", "2026-01-01", 13)).toBe("2027-02-01");
    expect(shiftPeriod("monthly", "2026-11-01", 0)).toBe("2026-11-01");
  });

  it("moves weeks by 7 days, over the daylight-saving change too", () => {
    expect(shiftPeriod("weekly", "2026-11-09", -1)).toBe("2026-11-02");
    expect(shiftPeriod("weekly", "2026-10-26", 1)).toBe("2026-11-02");
    expect(shiftPeriod("weekly", "2026-03-02", 1)).toBe("2026-03-09");
  });

  it("moves days by one", () => {
    expect(shiftPeriod("daily", "2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftPeriod("daily", "2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("periodEnd", () => {
  it("a month ends on its own last day, leap years included", () => {
    expect(periodEnd("monthly", "2026-11-01")).toBe("2026-11-30");
    expect(periodEnd("monthly", "2026-12-01")).toBe("2026-12-31");
    expect(periodEnd("monthly", "2026-02-01")).toBe("2026-02-28");
    expect(periodEnd("monthly", "2028-02-01")).toBe("2028-02-29");
  });

  it("a week ends on Sunday", () => {
    expect(periodEnd("weekly", "2026-11-09")).toBe("2026-11-15");
    expect(periodEnd("weekly", "2026-12-28")).toBe("2027-01-03");
  });

  it("a day ends on itself", () => {
    expect(periodEnd("daily", "2026-11-11")).toBe("2026-11-11");
  });
});

describe("periodCount", () => {
  it("counts both ends", () => {
    expect(periodCount("monthly", "2026-11-01", "2026-11-01")).toBe(1);
    expect(periodCount("monthly", "2026-10-01", "2026-11-01")).toBe(2);
    expect(periodCount("monthly", "2025-12-01", "2026-02-01")).toBe(3);
    expect(periodCount("weekly", "2026-10-26", "2026-11-09")).toBe(3);
    expect(periodCount("weekly", "2026-03-02", "2026-03-16")).toBe(3); // over the spring change
    expect(periodCount("daily", "2026-11-01", "2026-11-11")).toBe(11);
    expect(periodCount("daily", "2026-11-11", "2026-11-11")).toBe(1);
  });

  it("is 0 when the series would run backwards", () => {
    expect(periodCount("daily", "2026-11-12", "2026-11-11")).toBe(0);
    expect(periodCount("monthly", "2026-12-01", "2026-11-01")).toBe(0);
  });
});

describe("periodStartsOnPage", () => {
  // January to November 2026 is 11 months; 4 per page gives pages of 4, 4 and 3.
  const page = (n: number) =>
    periodStartsOnPage("monthly", "2026-01-01", "2026-11-01", n, 4);

  it("page 1 starts at the newest period and runs backwards", () => {
    expect(page(1)).toEqual([
      "2026-11-01",
      "2026-10-01",
      "2026-09-01",
      "2026-08-01",
    ]);
  });

  it("the last page is the short one and ends at the oldest period", () => {
    expect(page(3)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
  });

  it("a page past the end is empty", () => {
    expect(page(4)).toEqual([]);
  });

  it("weeks and days page the same way", () => {
    expect(
      periodStartsOnPage("weekly", "2026-10-26", "2026-11-09", 1, 2),
    ).toEqual(["2026-11-09", "2026-11-02"]);
    expect(
      periodStartsOnPage("weekly", "2026-10-26", "2026-11-09", 2, 2),
    ).toEqual(["2026-10-26"]);
    expect(
      periodStartsOnPage("daily", "2026-11-10", "2026-11-11", 1, 8),
    ).toEqual(["2026-11-11", "2026-11-10"]);
  });
});
