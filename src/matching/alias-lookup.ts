import { AliasType, normalizeAliasValue } from "../aliases/normalize-alias.js";
import { toUsE164 } from "../drivers/us-phone.js";
import { PaymentSource } from "../payments/payment.entity.js";

/** The alias type each payment source is matched against. Plaid and manual payments are not matched here. */
export const ALIAS_TYPE_BY_SOURCE: Partial<Record<PaymentSource, AliasType>> = {
  [PaymentSource.email_zelle]: AliasType.zelle,
  [PaymentSource.email_cashapp]: AliasType.cashapp,
  [PaymentSource.email_venmo]: AliasType.venmo,
  [PaymentSource.email_chime]: AliasType.chime,
  [PaymentSource.email_stripe]: AliasType.stripe,
};

/** Every known identity → its driver, keyed by type AND value (lookups always filter by type). */
export type AliasIndex = Map<string, { driverId: string; value: string }>;

const key = (type: AliasType, normalized: string) =>
  `${type}\u0000${normalized}`;

/**
 * Builds the index from the aliases and the drivers' own email and phone (a Zelle or Venmo email often shows
 * the payer's email or phone, which for a driver paying themselves is the one on their file).
 */
export function buildAliasIndex(
  aliases: {
    driverId: string;
    type: AliasType;
    value: string;
    valueNormalized: string;
  }[],
  drivers: { id: string; email: string; phone: string }[],
): AliasIndex {
  const index: AliasIndex = new Map();
  for (const driver of drivers) {
    index.set(key(AliasType.email, driver.email.toLowerCase()), {
      driverId: driver.id,
      value: driver.email,
    });
    index.set(key(AliasType.phone, driver.phone), {
      driverId: driver.id,
      value: driver.phone,
    });
  }
  // Aliases win over drivers' contact details only where they do not clash (both are unique per type).
  for (const alias of aliases) {
    index.set(key(alias.type, alias.valueNormalized), {
      driverId: alias.driverId,
      value: alias.value,
    });
  }
  return index;
}

/**
 * Adds a just-learned alias to the index of the current run, so the next payment from the same payer in the
 * same run matches exactly too. Never replaces an entry (one alias, one driver).
 */
export function addToIndex(
  index: AliasIndex,
  type: AliasType,
  normalized: string,
  entry: { driverId: string; value: string },
): void {
  if (!index.has(key(type, normalized)))
    index.set(key(type, normalized), entry);
}

/** A sure match: exactly one driver owns every identity of the payment that is known. */
export interface AliasHit {
  driverId: string;
  explanation: string;
}

/**
 * Exact lookup, type-filtered (spec 6.1 step 1, defect 1): the payer name and handle under the payment's own
 * method, plus the handle as an email or phone. Exactly one driver found → a hit. Two different drivers found
 * (e.g. the name is one driver's alias, the email another's) → no hit: the AI and a human must decide.
 */
export function findByAlias(
  payment: {
    source: PaymentSource;
    senderName: string;
    senderHandle: string | null;
  },
  index: AliasIndex,
): AliasHit | null {
  const type = ALIAS_TYPE_BY_SOURCE[payment.source];
  if (!type) return null;

  const lookups: [AliasType, string][] = [
    [type, normalizeAliasValue(type, payment.senderName)],
  ];
  const handle = payment.senderHandle?.trim();
  if (handle) {
    lookups.push([type, normalizeAliasValue(type, handle)]);
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(handle)) {
      lookups.push([AliasType.email, handle.toLowerCase()]);
    }
    const phone = toUsE164(handle);
    if (phone) lookups.push([AliasType.phone, phone]);
  }

  const hits = lookups.flatMap(([t, value]) => {
    const found = index.get(key(t, value));
    return found ? [{ ...found, type: t }] : [];
  });
  const driverIds = new Set(hits.map((hit) => hit.driverId));
  if (driverIds.size !== 1) return null;
  const [first] = hits;
  return {
    driverId: first.driverId,
    explanation: `Known ${first.type} alias "${first.value}"`,
  };
}

/** "  TIMOTHY   Sutton " → "timothy sutton": how names are compared. */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Step 2 (D48): the payer's name equals exactly ONE driver's full name ("First Last"), capitals and spaces
 * ignored. Two drivers with that name → no hit (the AI and a human decide). Free, instant and predictable,
 * so the AI is only asked about the rest.
 */
export function findByExactName(
  senderName: string,
  drivers: { id: string; firstName: string; lastName: string }[],
): AliasHit | null {
  const payer = normalizeName(senderName);
  const same = drivers.filter(
    (driver) =>
      normalizeName(`${driver.firstName} ${driver.lastName}`) === payer,
  );
  if (same.length !== 1) return null;
  return {
    driverId: same[0].id,
    explanation: `Payer name equals the driver's name "${same[0].firstName} ${same[0].lastName}"`,
  };
}
