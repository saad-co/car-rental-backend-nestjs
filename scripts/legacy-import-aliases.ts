/**
 * Developer tool: imports the old system's payment aliases into OUR `payment_aliases` (B42, B52, D48).
 * NOT part of the API. Run the drivers import first: aliases attach to drivers through `drivers.legacy_id`.
 *
 *   npm run legacy:import-aliases                                   dry run: shows what it would do
 *   npm run legacy:import-aliases -- --apply --target=<db name>     writes; <db name> must equal the target
 *                                                                   database's real name (printed by the dry run)
 *
 * Same safety as `legacy-import-drivers.ts`: the old database is read-only, everything is written in ONE
 * transaction, re-runs insert only what is new. Prints counts and skipped old ids only: no names or handles.
 */
import pg from "pg";
import { connectLegacyReadOnly } from "./legacy-db.js";
import {
  planAliasImport,
  type ExistingAlias,
  type LegacyAliasRow,
} from "./legacy/alias-mapping.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const target = args
  .find((arg) => arg.startsWith("--target="))
  ?.slice("--target=".length);

const targetUrl = process.env.DATABASE_URL;
if (!targetUrl) throw new Error("DATABASE_URL is missing.");
const { hostname: host, port } = new URL(targetUrl);
// Local or tunnelled (both localhost): no SSL needed. A public address: encrypted.
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
if (apply && !target) {
  throw new Error(
    "--apply needs --target=<database name>. Run without --apply first to see the name.",
  );
}

// 1. Read the old aliases (read-only connection).
const legacy = await connectLegacyReadOnly();
let rows: LegacyAliasRow[];
try {
  const result = await legacy.query<LegacyAliasRow>(
    `SELECT id::text AS id, driver_id::text AS driver_id, alias_type::text AS alias_type, alias_value
     FROM aliases ORDER BY created_at, id`,
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
  const nameResult = await db.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  const dbName = nameResult.rows[0]?.name;
  console.log(`Target database: "${dbName}" on ${host}:${port || 5432}`);
  console.log(
    apply ? "Mode: APPLY (writes)\n" : "Mode: dry run (writes nothing)\n",
  );
  if (apply && target !== dbName) {
    throw new Error(
      `--target=${target} does not match the target database "${dbName}". Nothing written.`,
    );
  }

  await db.query("BEGIN");
  const drivers = await db.query<{ id: string; legacy_id: string }>(
    "SELECT id::text AS id, legacy_id::text AS legacy_id FROM drivers WHERE legacy_id IS NOT NULL",
  );
  const existing = await db.query<ExistingAlias>(
    `SELECT driver_id::text AS "driverId", type::text AS type, value_normalized AS "valueNormalized"
     FROM payment_aliases FOR UPDATE`,
  );
  const plan = planAliasImport(
    rows,
    new Map(drivers.rows.map((d) => [d.legacy_id, d.id])),
    existing.rows,
  );

  console.log(`Old aliases read:   ${rows.length}`);
  console.log(`To insert:          ${plan.inserts.length}`);
  console.log(`Unchanged:          ${plan.unchanged}`);
  console.log(`Skipped:            ${plan.skips.length}`);
  for (const skip of plan.skips)
    console.log(`  skip ${skip.legacyId}: ${skip.reason}`);

  if (!apply) {
    await db.query("ROLLBACK");
    console.log("\nDry run: nothing written. Add --apply to write.");
  } else {
    for (const a of plan.inserts) {
      await db.query(
        `INSERT INTO payment_aliases (driver_id, type, value, value_normalized, source)
         VALUES ($1, $2, $3, $4, 'legacy')`,
        [a.driverId, a.type, a.value, a.valueNormalized],
      );
    }
    await db.query("COMMIT");
    console.log(`\nWritten: ${plan.inserts.length} inserted.`);
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
