import pg from "pg";

/**
 * Opens a connection to the OLD system's database (D44) that cannot write.
 *
 * `LEGACY_DATABASE_URL` logs in as that database's admin, so the session is forced read-only
 * (`default_transaction_read_only=on`: any INSERT/UPDATE/DELETE/DDL fails inside Postgres itself),
 * and we refuse to continue unless Postgres confirms it. The connection is encrypted because the
 * password crosses the internet; Railway's certificate is self-signed, so it is not verified.
 */
export async function connectLegacyReadOnly(): Promise<pg.Client> {
  const url = process.env.LEGACY_DATABASE_URL;
  if (!url) throw new Error("LEGACY_DATABASE_URL is missing. Add it to .env.");

  const client = new pg.Client({
    connectionString: url,
    options: "-c default_transaction_read_only=on",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query<{
    default_transaction_read_only: string;
  }>("SHOW default_transaction_read_only");
  if (rows[0]?.default_transaction_read_only !== "on") {
    await client.end();
    throw new Error(
      "The old database did not confirm read-only mode. Stopping before any query.",
    );
  }
  return client;
}
