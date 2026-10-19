import { describe, expect, it } from "vitest";
import { formatCents, parseAmountToCents } from "./money.js";

describe("parseAmountToCents", () => {
  it("reads whole dollars, dollars and cents, a dollar sign and thousands separators", () => {
    expect(parseAmountToCents("85")).toBe(8500);
    expect(parseAmountToCents("85.5")).toBe(8550);
    expect(parseAmountToCents("85.05")).toBe(8505);
    expect(parseAmountToCents("0.99")).toBe(99);
    expect(parseAmountToCents("$25.00")).toBe(2500);
    expect(parseAmountToCents(" $ 1,250.00 ")).toBe(125_000);
    expect(parseAmountToCents("1250")).toBe(125_000);
  });

  it("is null for anything that is not exactly an amount", () => {
    for (const text of [
      "",
      "late fee",
      "85.555",
      "-85",
      "1,25",
      "85.",
      ".5",
      "8 5",
      "CH-85",
      "85 dollars",
    ]) {
      expect(parseAmountToCents(text), text).toBeNull();
    }
  });

  it("is null for an amount the database's integer cannot hold", () => {
    expect(parseAmountToCents("21474836.47")).toBe(2_147_483_647);
    expect(parseAmountToCents("21474836.48")).toBeNull();
    expect(parseAmountToCents("99999999999999999999")).toBeNull();
  });
});

describe("formatCents", () => {
  it("writes dollars and cents with thousands separators", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(2550)).toBe("$25.50");
    expect(formatCents(100_000)).toBe("$1,000.00");
    expect(formatCents(123_456_789)).toBe("$1,234,567.89");
  });

  it("keeps the sign of a negative amount", () => {
    expect(formatCents(-2550)).toBe("-$25.50");
  });
});
