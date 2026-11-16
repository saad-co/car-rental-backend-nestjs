import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SettingsModule } from "../settings/settings.module.js";
import { FileStorageModule } from "../sms/storage/file-storage.module.js";
import { SmsModule } from "../sms/sms.module.js";
import { InspectionCaptureController } from "./inspection-capture.controller.js";
import { InspectionCaptureService } from "./inspection-capture.service.js";
import { InspectionEvent } from "./inspection-event.entity.js";
import { InspectionPhoto } from "./inspection-photo.entity.js";
import { InspectionShot } from "./inspection-shot.entity.js";
import { Inspection } from "./inspection.entity.js";
import { InspectionsController } from "./inspections.controller.js";
import { InspectionsService } from "./inspections.service.js";
import { TokenRateLimitGuard } from "./token-rate-limit.guard.js";

/**
 * Vehicle check-in / check-out photo inspections (Module 3, D102). The staff routes make an inspection and send or copy its
 * link (texting goes through the Quo chat in `SmsModule`); the public routes (`/i/:token`) are what the driver's capture page
 * calls: no login, photos kept in our file bucket.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Inspection,
      InspectionShot,
      InspectionPhoto,
      InspectionEvent,
    ]),
    SmsModule,
    SettingsModule,
    FileStorageModule,
  ],
  controllers: [InspectionsController, InspectionCaptureController],
  providers: [
    InspectionsService,
    InspectionCaptureService,
    TokenRateLimitGuard,
  ],
  exports: [InspectionsService],
})
export class InspectionsModule {}
