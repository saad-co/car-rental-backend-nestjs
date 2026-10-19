import { describe, expect, it } from "vitest";
import { formatCents } from "./money.js";

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
