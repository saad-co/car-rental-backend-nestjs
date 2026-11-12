import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DashboardModule } from "../dashboard/dashboard.module.js";
import { MessageTemplatesModule } from "../message-templates/message-templates.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { SmsModule } from "../sms/sms.module.js";
import { ReminderLog } from "./reminder-log.entity.js";
import { RemindersController } from "./reminders.controller.js";
import { RemindersJob } from "./reminders.job.js";
import { RemindersService } from "./reminders.service.js";

/**
 * Payment reminders (Fleet revisions section 6): the scheduled job, the rules it applies, the settings and the log staff
 * read on the driver's page. The lateness rules are the dashboard's (`DashboardModule` exports them), the texts are
 * editable templates, and the sending goes through the same `SmsService` as the chat.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ReminderLog]),
    DashboardModule,
    MessageTemplatesModule,
    SettingsModule,
    SmsModule,
  ],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersJob],
})
export class RemindersModule {}
