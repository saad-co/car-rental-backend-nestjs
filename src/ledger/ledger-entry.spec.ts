import {
  CHARGE_KINDS,
  CHARGE_KINDS_SQL,
  isCharge,
  LedgerDirection,
  LedgerEntryKind,
} from "./ledger-entry.entity.js";
import { ledgerRef } from "./ledger-ref.js";

describe("what counts as a charge (D83)", () => {
  it("is rent, a manual entry and a contract charge, and nothing else", () => {
    expect([...CHARGE_KINDS].sort()).toEqual([
      "adjustment",
      "contract_charge",
      "rent",
    ]);
    expect(CHARGE_KINDS_SQL).toBe("'rent', 'adjustment', 'contract_charge'");
  });

  it("is a charge only as a debit", () => {
    for (const kind of CHARGE_KINDS) {
      expect(isCharge({ kind, direction: LedgerDirection.debit })).toBe(true);
      expect(isCharge({ kind, direction: LedgerDirection.credit })).toBe(false);
    }
  });

  it("a payment or a reversal is never a charge", () => {
    for (const kind of [LedgerEntryKind.payment, LedgerEntryKind.reversal]) {
      for (const direction of Object.values(LedgerDirection)) {
        expect(isCharge({ kind, direction })).toBe(false);
      }
    }
  });

  it("a contract charge is shown as CH-<number> like any other charge", () => {
    expect(
      ledgerRef(LedgerEntryKind.contract_charge, LedgerDirection.debit, 1042),
    ).toBe("CH-1042");
  });
});
