import {
  AliasType,
  normalizeAliasValue,
} from "../../src/aliases/normalize-alias.js";

/** An alias as read from the old database. */
export interface LegacyAliasRow {
  id: string;
  driver_id: string;
  alias_type: string;
  alias_value: string | null;
}

/** An alias already in OUR database. */
export interface ExistingAlias {
  driverId: string;
  type: string;
  valueNormalized: string;
}

export interface AliasInsert {
  driverId: string;
  type: AliasType;
  value: string;
  valueNormalized: string;
}

export interface AliasImportPlan {
  inserts: AliasInsert[];
  unchanged: number;
  skips: { legacyId: string; reason: string }[];
}

/** Old type → ours. The old system had the same names; Stripe did not exist there. */
const TYPES: Record<string, AliasType> = {
  zelle: AliasType.zelle,
  cashapp: AliasType.cashapp,
  venmo: AliasType.venmo,
  chime: AliasType.chime,
  email: AliasType.email,
  phone: AliasType.phone,
};

/**
 * True when an old alias is not a real name or handle: the old email parser sometimes saved a chunk of the
 * email's own styling (`.Anchor-Text-Color A { Color: #0060F0; } Zelle Payment Jane Doe`). Real names and
 * handles are short and never contain braces or tags. Such an alias could never match a payment, so it is
 * left out instead of cluttering the driver's page.
 */
export function looksDamaged(value: string): boolean {
  return value.length > 80 || /[{}]/.test(value) || /<\/?[a-z]/i.test(value);
}

/**
 * Decides, for every old alias, insert / unchanged / skip. Pure: reads nothing, writes nothing.
 * Never guesses: an alias whose driver was not imported, or that would point at two drivers, is skipped with
 * the reason (one alias, one driver: a wrong owner would credit the wrong driver).
 *
 * @param ourDriverByLegacyId our driver id for each imported old driver id (`drivers.legacy_id`)
 */
export function planAliasImport(
  rows: LegacyAliasRow[],
  ourDriverByLegacyId: Map<string, string>,
  existing: ExistingAlias[],
): AliasImportPlan {
  const plan: AliasImportPlan = { inserts: [], unchanged: 0, skips: [] };
  const key = (type: string, value: string) => `${type}\u0000${value}`;

  const candidates: (AliasInsert & { legacyId: string })[] = [];
  for (const row of rows) {
    const skip = (reason: string) =>
      plan.skips.push({ legacyId: row.id, reason });
    const type = TYPES[row.alias_type];
    if (!type) {
      skip(`unknown alias_type "${row.alias_type}"`);
      continue;
    }
    const value = (row.alias_value ?? "").trim();
    if (value === "") {
      skip("empty value");
      continue;
    }
    if (looksDamaged(value)) {
      skip("value looks like leftover email formatting");
      continue;
    }
    const driverId = ourDriverByLegacyId.get(row.driver_id);
    if (!driverId) {
      skip("its driver was not imported");
      continue;
    }
    candidates.push({
      legacyId: row.id,
      driverId,
      type,
      value,
      valueNormalized: normalizeAliasValue(type, value),
    });
  }

  // The same alias for two different drivers in the OLD data: nobody knows whose it is.
  const ownersInOld = new Map<string, Set<string>>();
  for (const c of candidates) {
    const k = key(c.type, c.valueNormalized);
    ownersInOld.set(k, (ownersInOld.get(k) ?? new Set()).add(c.driverId));
  }
  const ownerInOurs = new Map(
    existing.map((e) => [key(e.type, e.valueNormalized), e.driverId]),
  );

  const planned = new Set<string>();
  for (const c of candidates) {
    const k = key(c.type, c.valueNormalized);
    if ((ownersInOld.get(k)?.size ?? 0) > 1) {
      plan.skips.push({
        legacyId: c.legacyId,
        reason: "same alias on two old drivers",
      });
      continue;
    }
    const owner = ownerInOurs.get(k);
    if (owner !== undefined) {
      if (owner === c.driverId) plan.unchanged++;
      else
        plan.skips.push({
          legacyId: c.legacyId,
          reason: "already an alias of another driver in our system",
        });
      continue;
    }
    // The same driver listed the same alias twice (e.g. different capitalisation): insert once.
    if (planned.has(k)) {
      plan.unchanged++;
      continue;
    }
    planned.add(k);
    plan.inserts.push({
      driverId: c.driverId,
      type: c.type,
      value: c.value,
      valueNormalized: c.valueNormalized,
    });
  }
  return plan;
}
