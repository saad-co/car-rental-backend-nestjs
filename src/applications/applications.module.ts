import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { MessageTemplatesModule } from "../message-templates/message-templates.module.js";
import { SmsModule } from "../sms/sms.module.js";
import { UsersModule } from "../users/users.module.js";
import { Application } from "./application.entity.js";
import { ApplicationAlertService } from "./application-alert.service.js";
import { ApplicationsController } from "./applications.controller.js";
import { ApplicationsService } from "./applications.service.js";
import {
  ApplicationDocumentCopier,
  DOCUMENT_COPIER_DEPS,
  type DocumentCopierDeps,
} from "./documents/application-document-copier.js";
import { ApplicationDocument } from "./documents/application-document.entity.js";
import { ApplicationNote } from "./notes/application-note.entity.js";
import { ApplicationNotesController } from "./notes/application-notes.controller.js";
import { ApplicationNotesService } from "./notes/application-notes.service.js";
import { ApplicationDocumentsController } from "./documents/application-documents.controller.js";
import { SupabaseDocumentSource } from "./documents/supabase-document-source.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import {
  FILE_STORAGE,
  FileStorageModule,
} from "../sms/storage/file-storage.module.js";

/**
 * Driver applications: intake from the website and admin review.
 *
 * `forFeature([...])` makes a `Repository` for each entity injectable in this module, and is
 * also how `autoLoadEntities` learns which entities exist. `Driver` is listed because
 * `Application` has a relation to it: TypeORM refuses to start if a relation points at an
 * entity it does not know. `UsersModule` (PasswordService) and `SmsModule` are needed by
 * approval, which creates the driver's login and texts it (D52).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Application,
      Driver,
      ApplicationDocument,
      ApplicationNote,
    ]),
    UsersModule,
    SmsModule,
    MessageTemplatesModule,
    FileStorageModule,
  ],
  controllers: [
    ApplicationsController,
    ApplicationDocumentsController,
    ApplicationNotesController,
  ],
  providers: [
    ApplicationsService,
    ApplicationNotesService,
    ApplicationAlertService,
    ApplicationDocumentCopier,
    {
      // The website's read-only document function (D54). Without DOCUMENTS_SOURCE_URL the source is null:
      // documents are listed as pending and nothing is copied.
      provide: DOCUMENT_COPIER_DEPS,
      inject: [ConfigService, FILE_STORAGE],
      useFactory: (
        config: ConfigService,
        storage: FileStorage | null,
      ): DocumentCopierDeps => {
        const functionUrl = config.get<string>("DOCUMENTS_SOURCE_URL");
        return {
          source: functionUrl
            ? new SupabaseDocumentSource({
                functionUrl,
                token: config.getOrThrow<string>("DOCUMENTS_SOURCE_TOKEN"),
              })
            : null,
          storage,
        };
      },
    },
  ],
})
export class ApplicationsModule {}
