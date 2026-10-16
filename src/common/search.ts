/**
 * Helpers for list searches (B75). Searches use Postgres `ILIKE`: `LIKE` that ignores case.
 * In a `LIKE` pattern `%` means "any text" and `_` "any one character"; `\` escapes them (Postgres' default escape
 * character).
 */

/**
 * The pattern that finds `text` anywhere in a value: `%text%`, with the user's own `%`, `_` and `\` escaped so they
 * are searched as plain characters. Without this, searching "50%" or "_" would match far more than typed.
 */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The digits of a search, to compare with phone numbers stored in any format ("(312) 555-0101", "3125550101").
 * Null when there are fewer than 3, so a name search that happens to contain a digit does not match every phone.
 */
export function phoneDigits(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}
