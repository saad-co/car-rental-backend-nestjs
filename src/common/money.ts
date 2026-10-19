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
