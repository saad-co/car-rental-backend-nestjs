import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { LedgerService } from "./ledger.service.js";

/**
 * Credits the ledger for payments confirmed before the ledger existed (D60). Run once per database after the
 * `CreateLedgerEntries` migration; running it again does nothing new.
 *
 * Dry run by default (counts only): `npm run ledger:backfill`. To write: `npm run ledger:backfill -- --apply`.
 */
async function backfill(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const { missing, credited } = await app
      .get(LedgerService)
      .backfillPaymentCredits(apply);
    console.log(
      apply
        ? `Credited ${credited} of ${missing} confirmed payments without a ledger credit.`
        : `Dry run: ${missing} confirmed payments have no ledger credit. Add --apply to credit them.`,
    );
  } finally {
    await app.close();
  }
}

backfill().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
