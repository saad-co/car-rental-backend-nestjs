import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AttachmentDownloader } from "./attachments/attachment-downloader.js";
import { QuoHttpClient } from "./quo/quo-http-client.js";
import type { FileStorage } from "./storage/file-storage.js";
import {
  FILE_STORAGE,
  FileStorageModule,
} from "./storage/file-storage.module.js";
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
  imports: [
    TypeOrmModule.forFeature([SmsMessage, SmsAttachment]),
    FileStorageModule,
  ],
  controllers: [SmsController, QuoWebhookController],
  providers: [
    SmsService,
    AttachmentDownloader,
    {
      provide: SMS_DEPS,
      inject: [ConfigService, FILE_STORAGE],
      useFactory: (
        config: ConfigService,
        fileStorage: FileStorage | null,
      ): SmsDeps => {
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
          storage: fileStorage,
        };
      },
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}
