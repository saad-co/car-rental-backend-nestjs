/** The largest amount a `ledger_entries.amount_cents` (integer column) can hold. */
const MAX_CENTS = 2_147_483_647;

/**
 * An amount typed into a search box as whole cents: `85`, `85.5`, `$1,250.00` or `0.99` give 8500, 8550, 125000 and
 * 99. Text that is not exactly an amount (a word, `85.555`, a negative, `1,25`) gives null, and so does an amount too
 * large for the database's integer. Integer maths only (spec rule 1): the digits are split, never multiplied as floats.
 */
export function parseAmountToCents(text: string): number | null {
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  const dollars = Number(match[1].replace(/,/g, ""));
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) && total <= MAX_CENTS ? total : null;
}

/**
 * Integer cents as dollars for a message: `2550` is `$25.50`, `123456789` is `$1,234,567.89`. Integer maths only
 * (spec rule 1), so no float rounding can show a wrong amount.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
