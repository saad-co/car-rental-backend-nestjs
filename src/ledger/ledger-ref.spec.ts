import { describe, expect, it } from "vitest";
import { LedgerDirection, LedgerEntryKind } from "./ledger-entry.entity.js";
import { ledgerRef, parseLedgerRef } from "./ledger-ref.js";

describe("ledgerRef", () => {
  it("names each kind with its letters", () => {
    const { debit, credit } = LedgerDirection;
    expect(ledgerRef(LedgerEntryKind.adjustment, debit, 1042)).toBe("CH-1042");
    expect(ledgerRef(LedgerEntryKind.rent, debit, 5)).toBe("CH-5");
    expect(ledgerRef(LedgerEntryKind.adjustment, credit, 7)).toBe("CR-7");
    expect(ledgerRef(LedgerEntryKind.payment, credit, 12)).toBe("PM-12");
    expect(ledgerRef(LedgerEntryKind.reversal, credit, 13)).toBe("RV-13");
    expect(ledgerRef(LedgerEntryKind.reversal, debit, 14)).toBe("RV-14");
  });
});

describe("parseLedgerRef", () => {
  it("reads the number from a reference in any case, with a dash, a space or nothing", () => {
    expect(parseLedgerRef("CH-1042")).toBe(1042);
    expect(parseLedgerRef("ch1042")).toBe(1042);
    expect(parseLedgerRef(" pm 7 ")).toBe(7);
    expect(parseLedgerRef("RV-3")).toBe(3);
    expect(parseLedgerRef("cr-0009")).toBe(9);
  });

  it("returns null for anything else", () => {
    expect(parseLedgerRef("1042")).toBeNull();
    expect(parseLedgerRef("late fee")).toBeNull();
    expect(parseLedgerRef("CH-")).toBeNull();
    expect(parseLedgerRef("CH-12x")).toBeNull();
    expect(parseLedgerRef("XX-12")).toBeNull();
    expect(parseLedgerRef("")).toBeNull();
  });
});
