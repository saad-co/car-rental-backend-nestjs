import { toUsE164 } from "../drivers/us-phone.js";

/** The kinds of alias: a payment method (names AND handles used there), or a contact detail used with any method. */
export enum AliasType {
  zelle = "zelle",
  cashapp = "cashapp",
  venmo = "venmo",
  chime = "chime",
  stripe = "stripe",
  email = "email",
  phone = "phone",
}

/**
 * The form an alias is stored and looked up in, so "TIMOTHY  SUTTON" and "timothy sutton" are the same alias:
 * lower-case, trimmed, inner spaces collapsed (spec 4). A Cash App/Venmo `$` or `@` prefix is dropped
 * (`$PatEx` and `PatEx` are the same handle). Phones become `+1XXXXXXXXXX` when they are US numbers.
 */
export function normalizeAliasValue(type: AliasType, value: string): string {
  const text = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (type === AliasType.phone) return toUsE164(text) ?? text;
  if (type === AliasType.cashapp || type === AliasType.venmo) {
    return text.replace(/^[$@]/, "");
  }
  return text;
}
