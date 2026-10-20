import { addMonths, contractNumbers, rateBreakdown } from "./contract-math.js";

const sum = (b: ReturnType<typeof rateBreakdown>) =>
  b.baseCents +
  b.insuranceCents +
  b.milesCents +
  b.maintenanceCents +
  b.taxCents;

describe("rateBreakdown (D71)", () => {
  it("splits $399 as the Illinois sheet does", () => {
    expect(rateBreakdown(39_900)).toEqual({
      baseCents: 16_758,
      insuranceCents: 11_970,
      milesCents: 5_187,
      maintenanceCents: 3_990,
      taxCents: 1_995,
    });
  });

  it("splits $409 (weekly sample)", () => {
    expect(rateBreakdown(40_900)).toEqual({
      baseCents: 17_178,
      insuranceCents: 12_270,
      milesCents: 5_317,
      maintenanceCents: 4_090,
      taxCents: 2_045,
    });
  });

  it("splits the daily $61 (Evergreen sample)", () => {
    expect(rateBreakdown(6_100)).toEqual({
      baseCents: 2_562,
      insuranceCents: 1_830,
      milesCents: 793,
      maintenanceCents: 610,
      taxCents: 305,
    });
  });

  it("adds up exactly for odd totals: the base rate takes the remainder", () => {
    const b = rateBreakdown(10_001);
    expect(b).toEqual({
      baseCents: 4_201,
      insuranceCents: 3_000,
      milesCents: 1_300,
      maintenanceCents: 1_000,
      taxCents: 500,
    });
    expect(sum(b)).toBe(10_001);
  });

  it("always adds up to the total, for every total in a range", () => {
    for (let total = 1; total <= 5_000; total++) {
      expect(sum(rateBreakdown(total))).toBe(total);
    }
  });

  it("rounds half up, and the largest allowed total stays exact", () => {
    expect(rateBreakdown(1).insuranceCents).toBe(0); // 0.3 cents
    expect(rateBreakdown(2).insuranceCents).toBe(1); // 0.6 cents
    expect(sum(rateBreakdown(1_000_000))).toBe(1_000_000);
  });
});

describe("addMonths", () => {
  it("adds whole months on the same day", () => {
    expect(addMonths("2026-10-13", 18)).toBe("2028-04-13");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
  });

  it("crosses a year end", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("contractNumbers (D71)", () => {
  const base = {
    totalRateCents: 39_900,
    startDate: "2026-10-13",
    termMonths: 18,
    securityDepositCents: 0,
    documentationFeeCents: 0,
    insuranceStartFeeCents: 0,
    otherOneTimeCents: 0,
    holdVehicleCents: 0,
    excessMileageCents: 0,
    insuranceExcessCents: 0,
    otherRecurringCents: 0,
  };

  it("amount due at pickup is the first payment plus the one-time charges", () => {
    const n = contractNumbers({ ...base, securityDepositCents: 20_000 });
    expect(n.paymentCents).toBe(39_900);
    expect(n.oneTimeTotalCents).toBe(20_000);
    expect(n.amountDueAtPickupCents).toBe(59_900);
    expect(n.endDate).toBe("2028-04-13");
  });

  it("sums all five one-time charges", () => {
    const n = contractNumbers({
      ...base,
      securityDepositCents: 10_000,
      documentationFeeCents: 2_000,
      insuranceStartFeeCents: 3_000,
      otherOneTimeCents: 500,
      holdVehicleCents: 1_500,
    });
    expect(n.oneTimeTotalCents).toBe(17_000);
    expect(n.amountDueAtPickupCents).toBe(56_900);
  });

  it("recurring total is the payment plus the three recurring charges", () => {
    const n = contractNumbers({
      ...base,
      excessMileageCents: 25,
      insuranceExcessCents: 5_000,
      otherRecurringCents: 1_000,
    });
    expect(n.recurringTotalCents).toBe(39_900 + 25 + 5_000 + 1_000);
  });

  it("matches the daily sample: $61 + $300 = $361", () => {
    const n = contractNumbers({
      ...base,
      totalRateCents: 6_100,
      securityDepositCents: 30_000,
    });
    expect(n.amountDueAtPickupCents).toBe(36_100);
  });
});
