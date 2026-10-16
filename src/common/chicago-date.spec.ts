import { describe, expect, it } from "vitest";
import { addDays, chicagoDate, isCalendarDate } from "./chicago-date.js";

describe("chicagoDate", () => {
  it("returns the Chicago day, not the UTC day, late in the evening", () => {
    // 04:30 UTC on the 19th is 11:30 PM CDT on the 18th.
    expect(chicagoDate(new Date("2026-10-19T04:30:00Z"))).toBe("2026-10-18");
    expect(chicagoDate(new Date("2026-10-19T05:00:00Z"))).toBe("2026-10-19");
  });

  it("follows daylight saving (CST is UTC-6 after 2026-11-01)", () => {
    expect(chicagoDate(new Date("2026-11-03T05:30:00Z"))).toBe("2026-11-02");
    expect(chicagoDate(new Date("2026-11-03T06:00:00Z"))).toBe("2026-11-03");
  });
});

describe("isCalendarDate", () => {
  it("accepts real days only", () => {
    expect(isCalendarDate("2026-10-17")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-1-5")).toBe(false);
    expect(isCalendarDate("17/10/2026")).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month, year and daylight-saving boundaries by whole days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-17", -90)).toBe("2026-07-19");
  });
});
