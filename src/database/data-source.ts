import "reflect-metadata";
import { DataSource } from "typeorm";
import { PaymentAlias } from "../aliases/payment-alias.entity.js";
import { Application } from "../applications/application.entity.js";
import { ApplicationDocument } from "../applications/documents/application-document.entity.js";
import { ApplicationNote } from "../applications/notes/application-note.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { LedgerEntry } from "../ledger/ledger-entry.entity.js";
import { InboundEmail } from "../email-intake/inbound-email.entity.js";
import { Payment } from "../payments/payment.entity.js";
import { SmsAttachment } from "../sms/sms-attachment.entity.js";
import { SmsMessage } from "../sms/sms-message.entity.js";
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
  entities: [
    User,
    Driver,
    Application,
    InboundEmail,
    Payment,
    PaymentAlias,
    SmsMessage,
    SmsAttachment,
    ApplicationDocument,
    ApplicationNote,
    LedgerEntry,
  ],
  // `.ts` when run from the sources (tsx, local), `.js` when run compiled (production). Never
  // both: the build also writes `.d.ts` type files next to each migration, which are not migrations.
  migrations: [
    `${import.meta.dirname}/migrations/*.${import.meta.filename.endsWith(".ts") ? "ts" : "js"}`,
  ],
});
