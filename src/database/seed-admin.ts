import { NestFactory } from "@nestjs/core";
import { isEmail } from "class-validator";
import { AppModule } from "../app.module.js";
import { MAX_PASSWORD_BYTES } from "../users/password.service.js";
import { Role } from "../users/user.entity.js";
import { UsersService } from "../users/users.service.js";

/** Shortest password the seed accepts. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Creates the first admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
 *
 * Safe to run more than once: if the email already exists it does nothing and never
 * overwrites that account's password. The password is never printed.
 *
 * Run with `npm run seed:admin`.
 */
async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !isEmail(email)) {
    throw new Error("ADMIN_EMAIL is missing or is not a valid email address.");
  }
  if (
    !password ||
    password.length < MIN_PASSWORD_LENGTH ||
    Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES
  ) {
    throw new Error(
      `ADMIN_PASSWORD must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_BYTES} bytes long.`,
    );
  }

  // Starts the whole Nest app (config, database, services) but without an HTTP server.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const users = app.get(UsersService);

    if (await users.findByEmail(email)) {
      console.log(`Admin already exists, nothing to do: ${email}`);
      return;
    }

    await users.create({ email, password, role: Role.admin });
    console.log(`Admin created: ${email}`);
  } finally {
    await app.close();
  }
}

seedAdmin().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
