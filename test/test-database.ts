/// <reference types="vite/client" />
import { DataSource, type MigrationInterface } from "typeorm";
import baseDataSource from "../src/database/data-source.js";

/**
 * The migration classes, loaded by Vite (the test runner) instead of by TypeORM: TypeORM imports the
 * `.ts` files with Node's own loader, which fails on their type-only imports.
 */
const migrationModules = import.meta.glob<
  Record<string, new () => MigrationInterface>
>("../src/database/migrations/*.ts", { eager: true });

/**
 * Connects to the test database (`DATABASE_URL_TEST`, set by `vitest.config.e2e.ts`) and brings it up to
 * date with every migration. Refuses any database whose name does not end in `_test`, because the
 * tests empty tables.
 */
export async function openTestDatabase(): Promise<DataSource> {
  const db = await new DataSource({
    ...baseDataSource.options,
    migrations: Object.values(migrationModules).flatMap((m) =>
      Object.values(m),
    ),
  }).initialize();
  const [{ name }] = (await db.query("SELECT current_database() AS name")) as [
    { name: string },
  ];
  if (!name.endsWith("_test")) {
    await db.destroy();
    throw new Error(`Refusing to run on database "${name}"`);
  }
  await db.runMigrations();
  return db;
}

/**
 * Puts known text templates in place (B73). The migration inserts the real defaults once, but a test's
 * `TRUNCATE users CASCADE` also empties `message_templates` (it references users), so tests that send templates call
 * this first. The bodies are short and predictable, for asserting the filled-in text.
 */
export async function seedTestTemplates(db: DataSource): Promise<void> {
  await db.query(
    `INSERT INTO message_templates (key, body) VALUES
       ('application_approved', 'Approved: {firstName} {lastName}'),
       ('application_declined', 'Declined: {firstName}')
     ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, updated_by_id = NULL`,
  );
}
