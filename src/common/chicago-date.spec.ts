import { describe, expect, it } from "vitest";
import {
  addDays,
  chicagoDate,
  chicagoInstant,
  daysBetween,
  isCalendarDate,
} from "./chicago-date.js";

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

describe("daysBetween", () => {
  it("counts whole calendar days, negative backwards, across daylight saving", () => {
    expect(daysBetween("2026-10-19", "2026-10-19")).toBe(0);
    expect(daysBetween("2026-10-19", "2026-10-26")).toBe(7);
    expect(daysBetween("2026-10-26", "2026-10-19")).toBe(-7);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});

describe("chicagoInstant", () => {
  const at = (day: string, time: string) =>
    chicagoInstant(day, time).toISOString();

  it("is 6 hours behind UTC in winter (CST) and 5 in summer (CDT)", () => {
    expect(at("2026-01-15", "18:00")).toBe("2026-01-16T00:00:00.000Z");
    expect(at("2026-07-15", "18:00")).toBe("2026-07-15T23:00:00.000Z");
    expect(at("2026-07-15", "00:00")).toBe("2026-07-15T05:00:00.000Z");
  });

  it("follows the spring-forward day, 2026-03-08 (2:00 AM becomes 3:00 AM)", () => {
    expect(at("2026-03-07", "18:00")).toBe("2026-03-08T00:00:00.000Z"); // CST
    expect(at("2026-03-08", "18:00")).toBe("2026-03-08T23:00:00.000Z"); // CDT
    expect(at("2026-03-08", "00:00")).toBe("2026-03-08T06:00:00.000Z"); // still CST
    expect(at("2026-03-08", "12:00")).toBe("2026-03-08T17:00:00.000Z"); // CDT
    expect(at("2026-03-09", "00:00")).toBe("2026-03-09T05:00:00.000Z"); // CDT
  });

  it("follows the fall-back day, 2026-11-01 (2:00 AM becomes 1:00 AM)", () => {
    expect(at("2026-10-31", "18:00")).toBe("2026-10-31T23:00:00.000Z"); // CDT
    expect(at("2026-11-01", "18:00")).toBe("2026-11-02T00:00:00.000Z"); // CST
    expect(at("2026-11-01", "00:00")).toBe("2026-11-01T05:00:00.000Z"); // still CDT
    expect(at("2026-11-02", "00:00")).toBe("2026-11-02T06:00:00.000Z"); // CST
  });

  it("round-trips: the Chicago day and time of the instant are the ones asked for", () => {
    for (const day of [
      "2026-03-07",
      "2026-03-08",
      "2026-11-01",
      "2026-12-25",
    ]) {
      for (const time of [
        "00:00",
        "12:00",
        "15:00",
        "18:00",
        "20:00",
        "23:59",
      ]) {
        const instant = chicagoInstant(day, time);
        expect(chicagoDate(instant)).toBe(day);
        const wall = new Intl.DateTimeFormat("en-GB", {
          timeZone: "America/Chicago",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(instant);
        expect(wall).toBe(time);
      }
    }
  });
});
