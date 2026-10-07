import "reflect-metadata";
import { DataSource } from "typeorm";
import { Application } from "../applications/application.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";
import { buildBaseOptions } from "./typeorm-options.js";

// Used by the TypeORM command line (migration:generate / run / revert), the seed script
// and the e2e tests. The running API gets its connection from AppModule instead.
// Add every new entity to the `entities` list.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set (copy .env.example to .env).");
}

export default new DataSource({
  ...buildBaseOptions(databaseUrl),
  entities: [User, Driver, Application],
  migrations: [`${import.meta.dirname}/migrations/*.{ts,js}`],
});
