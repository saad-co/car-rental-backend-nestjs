/**
 * Converts a US phone number as people type it into E.164 (`+1` followed by 10 digits),
 * the only format the `drivers` table accepts.
 *
 * Accepts `3125550123`, `(312) 555-0123`, `312.555.0123`, `13125550123` and `+1 312 555 0123`.
 * Returns null for anything else (too short, too long, another country code) so the caller can
 * report it instead of storing a guess.
 */
export function toUsE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
