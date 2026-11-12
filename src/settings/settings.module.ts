import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppSetting } from "./app-setting.entity.js";
import { SettingsService } from "./settings.service.js";

/** The `app_settings` table and its service (spec module "settings"). */
@Module({
  imports: [TypeOrmModule.forFeature([AppSetting])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
