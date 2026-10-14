import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AttachmentDownloader } from "./attachments/attachment-downloader.js";
import { QuoHttpClient } from "./quo/quo-http-client.js";
import { S3FileStorage } from "./storage/s3-file-storage.js";
import { QuoWebhookController } from "./quo-webhook.controller.js";
import { SmsAttachment } from "./sms-attachment.entity.js";
import { SmsMessage } from "./sms-message.entity.js";
import { SMS_DEPS, SmsService, type SmsDeps } from "./sms.service.js";
import { SmsController } from "./sms.controller.js";

/**
 * Texting with applicants and drivers through Quo (D50): the chat routes, the Quo webhook, and the history sync.
 *
 * Like the email intake, the real Quo client is built here from the settings and handed to the service as one
 * value (`SMS_DEPS`), so tests can give it a fake instead. With no API key the client is null: texts can still be
 * dry-run, and the chat just cannot sync history.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SmsMessage, SmsAttachment])],
  controllers: [SmsController, QuoWebhookController],
  providers: [
    SmsService,
    AttachmentDownloader,
    {
      provide: SMS_DEPS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SmsDeps => {
        const apiKey = config.get<string>("QUO_API_KEY");
        const phoneNumberId = config.get<string>("QUO_PHONE_NUMBER_ID");
        return {
          mode: config.getOrThrow<"off" | "dry_run" | "live">("SMS_MODE"),
          quo:
            apiKey && phoneNumberId
              ? new QuoHttpClient({ apiKey, phoneNumberId })
              : null,
          phoneNumberId: phoneNumberId || null,
          quoApiKey: apiKey || null,
          // No bucket set: files stay "pending" in the chat (S3_* are validated together in env.validation.ts).
          storage: config.get<string>("S3_BUCKET")
            ? new S3FileStorage({
                endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
                region: config.getOrThrow<string>("S3_REGION"),
                bucket: config.getOrThrow<string>("S3_BUCKET"),
                accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
                secretAccessKey: config.getOrThrow<string>(
                  "S3_SECRET_ACCESS_KEY",
                ),
                forcePathStyle:
                  config.get<string>("S3_FORCE_PATH_STYLE") === "true",
              })
            : null,
        };
      },
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}
