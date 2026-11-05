import { ContractSchedule } from "../contracts/contract.entity.js";
import { contractInForce, percent, weekdayIndex } from "./dashboard.service.js";

const contract = (startDate: string, signedAt: string | null = null) => ({
  driverId: "d1",
  schedule: ContractSchedule.weekly,
  totalRateCents: 40_900,
  startDate,
  signedAt: signedAt ? new Date(signedAt) : null,
});

describe("dashboard helpers", () => {
  describe("percent", () => {
    it("rounds to a whole number", () => {
      expect(percent(1, 3)).toBe(33);
      expect(percent(2, 3)).toBe(67);
      expect(percent(5, 7)).toBe(71);
    });
    it("is 0 when there is nothing to divide by", () => {
      expect(percent(0, 0)).toBe(0);
      expect(percent(3, 0)).toBe(0);
    });
  });

  describe("weekdayIndex", () => {
    it("counts Monday as 0 and Sunday as 6", () => {
      expect(weekdayIndex("2026-11-02")).toBe(0); // Monday
      expect(weekdayIndex("2026-11-05")).toBe(3); // Thursday
      expect(weekdayIndex("2026-11-08")).toBe(6); // Sunday
    });
  });

  describe("contractInForce", () => {
    it("picks the latest contract that has started", () => {
      const old = contract("2026-09-03");
      const current = contract("2026-10-22");
      const future = contract("2026-11-10");
      expect(contractInForce([future, old, current], "2026-11-05")).toBe(
        current,
      );
    });
    it("counts a contract from its start date", () => {
      const only = contract("2026-11-05");
      expect(contractInForce([only], "2026-11-05")).toBe(only);
      expect(contractInForce([only], "2026-11-04")).toBeNull();
    });
    it("takes the one signed last when two start the same day", () => {
      const first = contract("2026-10-22", "2026-10-20T10:00:00Z");
      const second = contract("2026-10-22", "2026-10-21T10:00:00Z");
      expect(contractInForce([second, first], "2026-11-05")).toBe(second);
    });
    it("is null with no contracts", () => {
      expect(contractInForce([], "2026-11-05")).toBeNull();
    });
  });
});
