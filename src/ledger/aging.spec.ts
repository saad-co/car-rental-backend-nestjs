import { describe, expect, it } from "vitest";
import { addDays } from "../common/chicago-date.js";
import { AgingEntry, ageBalance } from "./aging.js";
import { LedgerDirection } from "./ledger-entry.entity.js";

const TODAY = "2026-10-19";
const ago = (days: number) => addDays(TODAY, -days);
const charge = (cents: number, daysAgo: number): AgingEntry => ({
  direction: LedgerDirection.debit,
  amountCents: cents,
  effectiveDate: ago(daysAgo),
});
const credit = (cents: number, daysAgo: number): AgingEntry => ({
  direction: LedgerDirection.credit,
  amountCents: cents,
  effectiveDate: ago(daysAgo),
});

describe("ageBalance", () => {
  it("is all zeros with no entries", () => {
    expect(ageBalance([], TODAY)).toEqual({
      currentCents: 0,
      days7to13Cents: 0,
      days14to29Cents: 0,
      days30PlusCents: 0,
      pastDueCents: 0,
    });
  });

  it("puts an unpaid charge in the bucket of its age", () => {
    const aging = ageBalance(
      [charge(1000, 40), charge(2000, 20), charge(3000, 10), charge(4000, 2)],
      TODAY,
    );
    expect(aging).toEqual({
      currentCents: 4000,
      days7to13Cents: 3000,
      days14to29Cents: 2000,
      days30PlusCents: 1000,
      pastDueCents: 6000,
    });
  });

  it("counts the bucket edges: 6 days is current, 7, 14 and 30 days start the next buckets", () => {
    const edge = (days: number) => ageBalance([charge(100, days)], TODAY);
    expect(edge(0).currentCents).toBe(100);
    expect(edge(6).currentCents).toBe(100);
    expect(edge(7).days7to13Cents).toBe(100);
    expect(edge(13).days7to13Cents).toBe(100);
    expect(edge(14).days14to29Cents).toBe(100);
    expect(edge(29).days14to29Cents).toBe(100);
    expect(edge(30).days30PlusCents).toBe(100);
  });

  it("lets credits pay the oldest charge first", () => {
    // Owes 100 (40 days) + 300 (10 days) + 300 (2 days); pays 150: the old one is paid and 50 of the next.
    const aging = ageBalance(
      [
        charge(10_000, 40),
        charge(30_000, 10),
        charge(30_000, 2),
        credit(15_000, 1),
      ],
      TODAY,
    );
    expect(aging.days30PlusCents).toBe(0);
    expect(aging.days7to13Cents).toBe(25_000);
    expect(aging.currentCents).toBe(30_000);
    expect(aging.pastDueCents).toBe(25_000);
  });

  it("splits one charge when a payment covers only part of it", () => {
    const aging = ageBalance([charge(30_000, 20), credit(10_000, 5)], TODAY);
    expect(aging.days14to29Cents).toBe(20_000);
    expect(aging.pastDueCents).toBe(20_000);
  });

  it("shows nothing when the driver has paid ahead", () => {
    const aging = ageBalance([charge(10_000, 20), credit(25_000, 1)], TODAY);
    expect(aging.currentCents + aging.pastDueCents).toBe(0);
  });

  it("uses the date an entry belongs to, so a backdated charge is old", () => {
    const aging = ageBalance([charge(8500, 33)], TODAY);
    expect(aging.days30PlusCents).toBe(8500);
  });

  it("adds up to exactly what the driver owes", () => {
    const entries = [
      charge(12_345, 45),
      charge(999, 31),
      charge(5_001, 15),
      credit(7_000, 20),
      charge(300, 1),
      credit(1, 0),
    ];
    const aging = ageBalance(entries, TODAY);
    const owed = entries.reduce(
      (sum, e) =>
        sum +
        (e.direction === LedgerDirection.debit
          ? e.amountCents
          : -e.amountCents),
      0,
    );
    expect(
      aging.currentCents +
        aging.days7to13Cents +
        aging.days14to29Cents +
        aging.days30PlusCents,
    ).toBe(owed);
  });
});
