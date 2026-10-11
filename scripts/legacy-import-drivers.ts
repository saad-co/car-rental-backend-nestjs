/**
 * Developer tool: imports the old system's drivers into OUR database (D44, D45). NOT part of the API.
 *
 *   npm run legacy:import-drivers                                  dry run: shows what it would do, writes nothing
 *   npm run legacy:import-drivers -- --apply                       writes, if DATABASE_URL is a local database
 *   npm run legacy:import-drivers -- --apply --target=staging      writes to a REMOTE database (staging)
 *
 * Reads the old database read-only (LEGACY_DATABASE_URL, see legacy-db.ts) and writes to DATABASE_URL in ONE
 * transaction: if anything fails, nothing is written. Safe to re-run: `drivers.legacy_id` is unique, so a
 * re-run updates changed drivers and inserts only new ones. Never creates logins, never sends email.
 * Prints counts and skipped old ids only: no names, emails or phones.
 */
import pg from "pg";
import { connectLegacyReadOnly } from "./legacy-db.js";
import {
  planImport,
  type ExistingDriver,
  type LegacyDriverRow,
} from "./legacy/driver-mapping.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const target = args
  .find((arg) => arg.startsWith("--target="))
  ?.slice("--target=".length);

const targetUrl = process.env.DATABASE_URL;
if (!targetUrl) throw new Error("DATABASE_URL is missing.");
const host = new URL(targetUrl).hostname;
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);

console.log(`Target database: ${host} (${isLocal ? "local" : "REMOTE"})`);
console.log(
  apply ? "Mode: APPLY (writes)\n" : "Mode: dry run (writes nothing)\n",
);
if (apply && !isLocal && target !== "staging") {
  throw new Error(
    "Refusing to write to a remote database without --target=staging. Check DATABASE_URL first.",
  );
}

// 1. Read the old drivers (read-only connection). created_at as text: it is UTC without a zone (see parseLegacyUtc).
const legacy = await connectLegacyReadOnly();
let rows: LegacyDriverRow[];
try {
  const result = await legacy.query<LegacyDriverRow>(
    `SELECT id::text AS id, first_name, last_name, email, phone,
            billing_status::text AS billing_status, created_at::text AS created_at
     FROM drivers ORDER BY created_at`,
  );
  rows = result.rows;
} finally {
  await legacy.end();
}

// 2. Plan and write inside one transaction on OUR database.
const db = new pg.Client({
  connectionString: targetUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
await db.connect();
try {
  await db.query("BEGIN");
  const existing = await db.query<ExistingDriver>(
    `SELECT id::text AS id, legacy_id::text AS "legacyId", first_name AS "firstName", last_name AS "lastName",
            email, phone, status::text AS status
     FROM drivers FOR UPDATE`,
  );
  const plan = planImport(rows, existing.rows);

  console.log(`Old drivers read:   ${rows.length}`);
  console.log(`To insert:          ${plan.inserts.length}`);
  console.log(`To update:          ${plan.updates.length}`);
  console.log(`Unchanged:          ${plan.unchanged}`);
  console.log(`Skipped:            ${plan.skips.length}`);
  for (const skip of plan.skips)
    console.log(`  skip ${skip.legacyId}: ${skip.reason}`);

  if (!apply) {
    await db.query("ROLLBACK");
    console.log("\nDry run: nothing written. Add --apply to write.");
  } else {
    for (const d of plan.inserts) {
      await db.query(
        `INSERT INTO drivers (legacy_id, first_name, last_name, email, phone, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`,
        [
          d.legacyId,
          d.firstName,
          d.lastName,
          d.email,
          d.phone,
          d.status,
          d.createdAt?.toISOString() ?? null,
        ],
      );
    }
    for (const { id, driver: d } of plan.updates) {
      await db.query(
        `UPDATE drivers SET first_name = $2, last_name = $3, email = $4, phone = $5, status = $6, updated_at = now()
         WHERE id = $1 AND legacy_id = $7`,
        [id, d.firstName, d.lastName, d.email, d.phone, d.status, d.legacyId],
      );
    }
    await db.query("COMMIT");
    console.log(
      `\nWritten: ${plan.inserts.length} inserted, ${plan.updates.length} updated.`,
    );
  }
} catch (error) {
  // Undo everything, then let the original error stop the script (it is printed, never hidden).
  await db.query("ROLLBACK").catch((rollbackError: unknown) => {
    console.error("ROLLBACK also failed:", rollbackError);
  });
  throw error;
} finally {
  await db.end();
}
