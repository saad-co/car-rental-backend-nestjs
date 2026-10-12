import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MatchingModule } from "../matching/matching.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import {
  EMAIL_INTAKE_DEPS,
  EmailIntakeService,
  type EmailIntakeDeps,
} from "./email-intake.service.js";
import { EmailIntakeScheduler } from "./email-intake.scheduler.js";
import { GeminiJsonClient } from "./gemini-client.js";
import { ImapMailboxReader } from "./imap-mailbox-reader.js";
import { InboundEmail } from "./inbound-email.entity.js";
import { InboundEmailsController } from "./inbound-emails.controller.js";
import { InboundEmailsService } from "./inbound-emails.service.js";
import { LlmPaymentExtractor } from "./llm-payment-extractor.js";

/**
 * Payment email intake (spec M3): reads `gonzobilling@gmail.com` every 3 minutes, verifies, extracts and
 * stores each new payment email. Also serves the admin email log (`GET /inbound-emails`).
 *
 * The real mailbox and AI are built here from the settings and handed to the service as one value
 * (`EMAIL_INTAKE_DEPS`). Like passing dependencies into a factory function in Express: the service
 * never reads settings itself, so the e2e test can hand it a fake mailbox and a fake AI instead.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([InboundEmail]),
    PaymentsModule,
    MatchingModule,
  ],
  controllers: [InboundEmailsController],
  providers: [
    InboundEmailsService,
    {
      provide: EMAIL_INTAKE_DEPS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmailIntakeDeps | null => {
        // Switched off: no IMAP or LLM settings are needed, and every run returns at once.
        if (config.get<string>("EMAIL_INTAKE_ENABLED") !== "true") return null;
        const startAfterUid = config.get<string>("IMAP_START_AFTER_UID");
        return {
          mailbox: new ImapMailboxReader({
            host: config.getOrThrow<string>("IMAP_HOST"),
            port: config.getOrThrow<number>("IMAP_PORT"),
            user: config.getOrThrow<string>("IMAP_USER"),
            password: config.getOrThrow<string>("IMAP_PASSWORD"),
          }),
          extractor: new LlmPaymentExtractor(
            new GeminiJsonClient({
              apiKey: config.getOrThrow<string>("LLM_API_KEY"),
              model: config.getOrThrow<string>("LLM_MODEL"),
            }),
          ),
          trustedServerId: config.getOrThrow<string>("IMAP_TRUSTED_SERVER"),
          startAfterUid: startAfterUid ? Number(startAfterUid) : null,
        };
      },
    },
    EmailIntakeService,
    EmailIntakeScheduler,
  ],
  exports: [EmailIntakeService],
})
export class EmailIntakeModule {}
