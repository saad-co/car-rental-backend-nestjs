import type { DataSourceOptions } from "typeorm";

// Connection settings shared by the running app (AppModule) and the command-line tools
// (data-source.ts), so they can never disagree.
export function buildBaseOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: "postgres",
    url: databaseUrl,
    // Never let TypeORM change tables by itself at startup (it can drop columns).
    // The schema changes only through reviewed migration files.
    synchronize: false,
    // Generate uuid defaults with Postgres's built-in gen_random_uuid() (Postgres 13+).
    // "pgcrypto" only selects that function name; installExtensions: false stops TypeORM
    // from running CREATE EXTENSION on every connect, which we don't need.
    uuidExtension: "pgcrypto",
    installExtensions: false,
  };
}
