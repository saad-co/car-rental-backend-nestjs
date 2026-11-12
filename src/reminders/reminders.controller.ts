import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto.js";
import { SettingsService } from "../settings/settings.service.js";
import { SmsService } from "../sms/sms.service.js";
import {
  ReminderLogListDto,
  ReminderSettingsDto,
  UpdateReminderSettingsDto,
} from "./dto/reminder.dto.js";
import { RemindersService } from "./reminders.service.js";

/**
 * Payment reminders (Fleet revisions section 6): the settings, and the reminders sent to a driver. Admin only (the global
 * guard). The sending itself is the scheduled `RemindersJob`; nothing here sends a text.
 */
@Controller()
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly settings: SettingsService,
    private readonly sms: SmsService,
  ) {}

  /** `GET /settings/reminders`: the switch, the payment link, and how texting is set up. */
  @Get("settings/reminders")
  getSettings(): Promise<ReminderSettingsDto> {
    return this.settingsDto();
  }

  /**
   * `PUT /settings/reminders`: turns the automatic reminders on or off and sets the payment link. Off by default: nothing is
   * texted until an admin turns it on. `400` for a link that is not an http(s) address.
   */
  @Put("settings/reminders")
  async saveSettings(
    @Body() body: UpdateReminderSettingsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ReminderSettingsDto> {
    await this.settings.saveReminders(
      { enabled: body.enabled, paymentLink: body.paymentLink ?? null },
      admin.id,
    );
    return this.settingsDto();
  }

  /** `GET /drivers/:id/reminders`: the reminders sent to the driver, newest first. `404` unknown driver. */
  @Get("drivers/:id/reminders")
  listForDriver(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ReminderLogListDto> {
    return this.reminders.listForDriver(id, query);
  }

  private async settingsDto(): Promise<ReminderSettingsDto> {
    const settings = await this.settings.reminders();
    const status = this.sms.status();
    return {
      enabled: settings.enabled,
      enabledAt: settings.enabledAt,
      paymentLink: settings.paymentLink,
      smsMode: status.mode,
      quoConfigured: status.quoConfigured,
    };
  }
}
