import { LedgerDirection, LedgerEntryKind } from "./ledger-entry.entity.js";

/**
 * The short reference an admin sees and says aloud ("CH-1042"): the type's letters and the entry's number. CH is a
 * charge (a debit: rent, a contract charge or a manual charge), CR a credit entered by hand, PM a payment, RV a reversal.
 * The number is the database's `entry_no`; one number is one entry, whatever the letters say.
 */
export function ledgerRef(
  kind: LedgerEntryKind,
  direction: LedgerDirection,
  entryNo: number,
): string {
  const prefix =
    kind === LedgerEntryKind.payment
      ? "PM"
      : kind === LedgerEntryKind.reversal
        ? "RV"
        : direction === LedgerDirection.debit
          ? "CH"
          : "CR";
  return `${prefix}-${entryNo}`;
}

/**
 * The entry number in text typed into the search box: `CH-1042`, `ch1042` or `PM 7`. Text without one of the four
 * prefixes (a plain `1042`, or a word) is not a reference and returns null, so it is searched as ordinary text.
 */
export function parseLedgerRef(text: string): number | null {
  const match = /^(?:CH|CR|PM|RV)[-\s]?(\d{1,15})$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}
