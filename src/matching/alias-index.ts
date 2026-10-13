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

/** A sure match: exactly one driver owns every identity of the payment that is known. */
export interface AliasHit {
  driverId: string;
  explanation: string;
}

/** An alias as the index needs it. */
export interface AliasEntry {
  driverId: string;
  type: AliasType;
  value: string;
  valueNormalized: string;
}

/**
 * Every known payer identity mapped to its driver: aliases plus the drivers' own email and phone (a Zelle or
 * Venmo email often shows the payer's email or phone, which for a driver paying themselves is the one on file).
 * Entries are keyed by type AND value, so a lookup can never cross payment methods (reference defect 1).
 * Built once per matching run; not an injectable provider because it holds one run's data.
 */
export class AliasIndex {
  private readonly entries = new Map<
    string,
    { driverId: string; value: string }
  >();

  private constructor() {}

  private static key(type: AliasType, normalized: string): string {
    return `${type}\u0000${normalized}`;
  }

  /** Builds the index from the aliases and the drivers' own contact details. */
  static build(
    aliases: AliasEntry[],
    drivers: { id: string; email: string; phone: string }[],
  ): AliasIndex {
    const index = new AliasIndex();
    for (const driver of drivers) {
      index.entries.set(
        AliasIndex.key(AliasType.email, driver.email.toLowerCase()),
        {
          driverId: driver.id,
          value: driver.email,
        },
      );
      index.entries.set(AliasIndex.key(AliasType.phone, driver.phone), {
        driverId: driver.id,
        value: driver.phone,
      });
    }
    // Aliases are unique per type, so they only overwrite a contact detail that is also someone's alias.
    for (const alias of aliases) {
      index.entries.set(AliasIndex.key(alias.type, alias.valueNormalized), {
        driverId: alias.driverId,
        value: alias.value,
      });
    }
    return index;
  }

  /**
   * Adds a just-learned alias, so the next payment from the same payer in the same run matches exactly too.
   * Never replaces an entry (one alias, one driver).
   */
  add(
    type: AliasType,
    normalized: string,
    entry: { driverId: string; value: string },
  ): void {
    const key = AliasIndex.key(type, normalized);
    if (!this.entries.has(key)) this.entries.set(key, entry);
  }

  /**
   * Exact lookup, type-filtered (spec 6.1 step 1): the payer name and handle under the payment's own method,
   * plus the handle as an email or phone. Exactly one driver found → a hit. Two different drivers found (e.g.
   * the name is one driver's alias, the email another's) → no hit: the AI and a human must decide.
   */
  find(payment: {
    source: PaymentSource;
    senderName: string;
    senderHandle: string | null;
  }): AliasHit | null {
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
      const found = this.entries.get(AliasIndex.key(t, value));
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
}
