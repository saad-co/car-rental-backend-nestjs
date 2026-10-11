import { toUsE164 } from "../../src/drivers/us-phone.js";

/** A driver row as read from the old database. `created_at` is read as text (see `parseLegacyUtc`). */
export interface LegacyDriverRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  billing_status: string | null;
  created_at: string | null;
}

/** A driver as it will be stored in our `drivers` table. */
export interface ImportedDriver {
  legacyId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: "active" | "inactive";
  createdAt: Date | null;
}

/** A driver already in OUR database (imported earlier, or created here by an approval). */
export interface ExistingDriver {
  id: string;
  legacyId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
}

export interface Skip {
  legacyId: string;
  reason: string;
}

export type MappingResult =
  { kind: "driver"; driver: ImportedDriver } | { kind: "skip"; skip: Skip };

export interface ImportPlan {
  inserts: ImportedDriver[];
  updates: { id: string; driver: ImportedDriver }[];
  unchanged: number;
  skips: Skip[];
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The old database stores times as "timestamp without time zone", written in UTC. The `pg` library
 * would read them as the computer's LOCAL time (e.g. Pakistan, UTC+5) and shift every date, so we
 * read them as text and say explicitly that they are UTC.
 */
export function parseLegacyUtc(text: string | null): Date | null {
  if (!text) return null;
  const date = new Date(`${text.trim().replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Turns one old row into our driver, or a skip with the reason. Our rules: names present (max 100),
 * a valid lower-case email, a US phone in +1 format, a known status. Never guesses a value.
 */
export function mapLegacyDriver(row: LegacyDriverRow): MappingResult {
  const skip = (reason: string): MappingResult => ({
    kind: "skip",
    skip: { legacyId: row.id, reason },
  });

  const firstName = (row.first_name ?? "").trim();
  const lastName = (row.last_name ?? "").trim();
  if (firstName === "" || lastName === "")
    return skip("first or last name missing");
  if (firstName.length > 100 || lastName.length > 100)
    return skip("name longer than 100 characters");

  const email = (row.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254)
    return skip("email missing or invalid");

  const phone = toUsE164(row.phone ?? "");
  if (phone === null) return skip("phone is not a US number");

  // Paused is a billing state (it arrives with M2): the driver is still with the fleet.
  const statuses: Record<string, "active" | "inactive"> = {
    active: "active",
    paused: "active",
    terminated: "inactive",
  };
  const status = statuses[row.billing_status ?? ""];
  if (status === undefined)
    return skip(`unknown billing_status "${row.billing_status}"`);

  return {
    kind: "driver",
    driver: {
      legacyId: row.id,
      firstName,
      lastName,
      email,
      phone,
      status,
      createdAt: parseLegacyUtc(row.created_at),
    },
  };
}

/**
 * Decides, for every old row, insert / update / unchanged / skip. Pure: reads nothing, writes nothing.
 *
 * Skipped as well: an email or phone shared by 2+ old drivers (we cannot tell whose it is), and an
 * email or phone already used by another driver in OUR database. A driver created here is never
 * overwritten or merged; a human decides.
 */
export function planImport(
  rows: LegacyDriverRow[],
  existing: ExistingDriver[],
): ImportPlan {
  const plan: ImportPlan = {
    inserts: [],
    updates: [],
    unchanged: 0,
    skips: [],
  };

  const mapped: ImportedDriver[] = [];
  for (const row of rows) {
    const result = mapLegacyDriver(row);
    if (result.kind === "skip") plan.skips.push(result.skip);
    else mapped.push(result.driver);
  }

  const countBy = (key: (d: ImportedDriver) => string) => {
    const counts = new Map<string, number>();
    for (const driver of mapped)
      counts.set(key(driver), (counts.get(key(driver)) ?? 0) + 1);
    return counts;
  };
  const emailCounts = countBy((d) => d.email);
  const phoneCounts = countBy((d) => d.phone);
  const byLegacyId = new Map(
    existing.filter((e) => e.legacyId).map((e) => [e.legacyId, e]),
  );

  for (const driver of mapped) {
    if ((emailCounts.get(driver.email) ?? 0) > 1) {
      plan.skips.push({
        legacyId: driver.legacyId,
        reason: "email shared with another old driver",
      });
      continue;
    }
    if ((phoneCounts.get(driver.phone) ?? 0) > 1) {
      plan.skips.push({
        legacyId: driver.legacyId,
        reason: "phone shared with another old driver",
      });
      continue;
    }

    const self = byLegacyId.get(driver.legacyId);
    const others = existing.filter((e) => e !== self);
    if (others.some((e) => e.email === driver.email)) {
      plan.skips.push({
        legacyId: driver.legacyId,
        reason: "email already used by another driver in our system",
      });
      continue;
    }
    if (others.some((e) => e.phone === driver.phone)) {
      plan.skips.push({
        legacyId: driver.legacyId,
        reason: "phone already used by another driver in our system",
      });
      continue;
    }

    if (!self) {
      plan.inserts.push(driver);
    } else if (
      self.firstName !== driver.firstName ||
      self.lastName !== driver.lastName ||
      self.email !== driver.email ||
      self.phone !== driver.phone ||
      self.status !== driver.status
    ) {
      plan.updates.push({ id: self.id, driver });
    } else {
      plan.unchanged++;
    }
  }
  return plan;
}
