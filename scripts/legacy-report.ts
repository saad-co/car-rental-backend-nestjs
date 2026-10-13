/**
 * Developer tool: a READ-ONLY dry-run report of the old system's database (D44, B42). Imports nothing.
 *
 *   npm run legacy:report               counts only: tables, columns, conflicts with our rules (no personal data)
 *   npm run legacy:report -- --details  also writes the conflicting rows to ../legacy-reports/ (outside both repos)
 *
 * Needs LEGACY_DATABASE_URL in .env (the old Postgres's public address). That login is the old database's admin,
 * so every session is forced read-only and the script refuses to run if Postgres does not confirm it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { connectLegacyReadOnly } from "./legacy-db.js";

const details = process.argv.includes("--details");
const reportDir = path.resolve("../legacy-reports");

// Read-only by construction and verified with Postgres before any query (see legacy-db.ts).
const client = await connectLegacyReadOnly();
try {
  console.log("Connected, session is READ-ONLY.\n");

  await reportTables();
  await reportColumns(["drivers", "applications", "aliases"]);
  await reportDrivers();
  await reportApplications();
  await reportAliases();
} finally {
  await client.end();
}

/** Row counts of the tables that matter for the import. */
async function reportTables(): Promise<void> {
  console.log("== Tables (rows)");
  const tables = await existingTables();
  for (const table of [
    "drivers",
    "applications",
    "aliases",
    "vehicles",
    "driver_vehicle_assignments",
    "payments_raw",
    "ledger",
    "staff",
  ]) {
    if (!tables.has(table)) {
      console.log(`  ${table.padEnd(28)} (no such table)`);
      continue;
    }
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM "${table}"`,
    );
    console.log(`  ${table.padEnd(28)} ${rows[0]?.n}`);
  }
}

/** The real columns (the old code's models may differ from the database). Names and types only. */
async function reportColumns(tables: string[]): Promise<void> {
  for (const table of tables) {
    const { rows } = await client.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
    }>(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    console.log(`\n== Columns of ${table}`);
    console.log(
      `  ${rows.map((r) => `${r.column_name} (${r.data_type === "USER-DEFINED" ? r.udt_name : r.data_type})`).join(", ")}`,
    );
  }
}

/** What would clash with our drivers table: unique lower-case email, unique US phone stored as +1XXXXXXXXXX. */
async function reportDrivers(): Promise<void> {
  console.log("\n== Drivers vs our rules");
  const one = async (label: string, sql: string) => {
    const { rows } = await client.query<{ n: string }>(sql);
    console.log(`  ${label.padEnd(52)} ${rows[0]?.n}`);
  };
  const phoneDigits = `regexp_replace(coalesce(phone, ''), '\\D', '', 'g')`;
  const usPhone = `(CASE WHEN length(${phoneDigits}) = 10 THEN ${phoneDigits}
                         WHEN length(${phoneDigits}) = 11 AND left(${phoneDigits}, 1) = '1' THEN right(${phoneDigits}, 10) END)`;
  await one("drivers in total", `SELECT count(*) AS n FROM drivers`);
  await one(
    "email missing or not an email address",
    `SELECT count(*) AS n FROM drivers WHERE coalesce(email, '') !~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`,
  );
  await one(
    "emails shared by 2+ drivers (rows involved)",
    `SELECT coalesce(sum(c), 0) AS n FROM (SELECT count(*) AS c FROM drivers GROUP BY lower(trim(email)) HAVING count(*) > 1) d`,
  );
  await one(
    "phone is not a US number (10 digits or 1+10)",
    `SELECT count(*) AS n FROM drivers WHERE ${usPhone} IS NULL`,
  );
  await one(
    "US phones shared by 2+ drivers (rows involved)",
    `SELECT coalesce(sum(c), 0) AS n FROM (SELECT count(*) AS c FROM drivers WHERE ${usPhone} IS NOT NULL GROUP BY ${usPhone} HAVING count(*) > 1) d`,
  );
  await one(
    "date of birth present (encrypted)",
    `SELECT count(*) AS n FROM drivers WHERE dob_encrypted IS NOT NULL`,
  );
  await one(
    "address present (encrypted)",
    `SELECT count(*) AS n FROM drivers WHERE address_encrypted IS NOT NULL`,
  );
  await distribution(
    "billing_status",
    `SELECT billing_status::text AS k, count(*) AS n FROM drivers GROUP BY 1 ORDER BY 2 DESC`,
  );
  await distribution(
    "billing_type",
    `SELECT billing_type::text AS k, count(*) AS n FROM drivers GROUP BY 1 ORDER BY 2 DESC`,
  );

  if (details) {
    const { rows } = await client.query(
      `SELECT id, first_name, last_name, email, phone, billing_status::text AS status, created_at::date AS created, terminated_at::date AS terminated,
              CASE WHEN coalesce(email, '') !~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' THEN 'bad email'
                   WHEN ${usPhone} IS NULL THEN 'non-US phone'
                   WHEN lower(trim(email)) IN (SELECT lower(trim(email)) FROM drivers GROUP BY 1 HAVING count(*) > 1) THEN 'shared email'
                   WHEN ${usPhone} IN (SELECT ${usPhone} FROM drivers GROUP BY 1 HAVING count(*) > 1) THEN 'shared phone'
              END AS problem
       FROM drivers ORDER BY problem, lower(trim(email))`,
    );
    await writeCsv(
      "drivers-conflicts.csv",
      rows.filter((row: { problem: string | null }) => row.problem !== null),
    );
  }
}

async function reportApplications(): Promise<void> {
  console.log("\n== Applications");
  await distribution(
    "status",
    `SELECT status::text AS k, count(*) AS n FROM applications GROUP BY 1 ORDER BY 2 DESC`,
  );
  await distribution(
    "linked to a driver",
    `SELECT (driver_id IS NOT NULL)::text AS k, count(*) AS n FROM applications GROUP BY 1`,
  );
  await distribution(
    "form_data keys (how many applications have each)",
    `SELECT key AS k, count(*) AS n FROM applications, jsonb_object_keys(form_data) AS key GROUP BY 1 ORDER BY 2 DESC, 1`,
  );
}

async function reportAliases(): Promise<void> {
  console.log("\n== Aliases");
  await distribution(
    "alias_type",
    `SELECT alias_type::text AS k, count(*) AS n FROM aliases GROUP BY 1 ORDER BY 2 DESC`,
  );
  const norm = `lower(regexp_replace(trim(alias_value), '\\s+', ' ', 'g'))`;
  const { rows } = await client.query<{ same_type: string; any_type: string }>(
    `SELECT
       (SELECT count(*) FROM (SELECT 1 FROM aliases GROUP BY alias_type, ${norm} HAVING count(DISTINCT driver_id) > 1) a) AS same_type,
       (SELECT count(*) FROM (SELECT 1 FROM aliases GROUP BY ${norm} HAVING count(DISTINCT driver_id) > 1) a) AS any_type`,
  );
  console.log(
    `  same type + value on 2+ different drivers (clash) ${rows[0]?.same_type}`,
  );
  console.log(
    `  same value on 2+ drivers, any type (defect-1 risk) ${rows[0]?.any_type}`,
  );
}

async function distribution(label: string, sql: string): Promise<void> {
  const { rows } = await client.query<{ k: string | null; n: string }>(sql);
  console.log(
    `  ${label}: ${rows.map((r) => `${r.k ?? "(null)"}=${r.n}`).join(", ")}`,
  );
}

async function existingTables(): Promise<Set<string>> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  return new Set(rows.map((row) => row.table_name));
}

/** Personal data: written only with --details, only outside both repos. */
async function writeCsv(
  file: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  await mkdir(reportDir, { recursive: true });
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const cell = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((c) => cell(row[c])).join(",")),
  ].join("\n");
  await writeFile(path.join(reportDir, file), `${csv}\n`);
  console.log(
    `  details written: ${path.join(reportDir, file)} (${rows.length} rows)`,
  );
}
