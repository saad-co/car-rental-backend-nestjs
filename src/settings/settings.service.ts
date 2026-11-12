import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { AppSetting } from "./app-setting.entity.js";

const REMINDERS_ENABLED = "reminders_enabled";
const REMINDERS_ENABLED_AT = "reminders_enabled_at";
const PAYMENT_LINK = "payment_link";

/** The payment-reminder settings (Fleet revisions section 6). */
export interface ReminderSettings {
  /** The master switch. Off until staff turn it on, so no environment texts drivers by surprise. */
  enabled: boolean;
  /** When the switch was last turned on: confirmations are only sent for payments after this moment. */
  enabledAt: Date | null;
  /** Where drivers pay (`{paymentLink}` in the texts); null until the client says what it is. */
  paymentLink: string | null;
}

/** Reads and writes `app_settings`. Express comparison: a tiny settings-model module next to the routes. */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly settings: Repository<AppSetting>,
  ) {}

  /** The reminder settings; every one has a safe default (off, no link). */
  async reminders(): Promise<ReminderSettings> {
    const rows = await this.settings.findBy({
      key: In([REMINDERS_ENABLED, REMINDERS_ENABLED_AT, PAYMENT_LINK]),
    });
    const value = (key: string) => rows.find((r) => r.key === key)?.value;
    return {
      enabled: value(REMINDERS_ENABLED) === "true",
      enabledAt: value(REMINDERS_ENABLED_AT)
        ? new Date(value(REMINDERS_ENABLED_AT)!)
        : null,
      paymentLink: value(PAYMENT_LINK) || null,
    };
  }

  /** Saves the switch and the link; turning the switch on (from off) stamps `enabledAt`. */
  async saveReminders(
    input: { enabled: boolean; paymentLink: string | null },
    adminId: string,
    now: Date = new Date(),
  ): Promise<ReminderSettings> {
    const before = await this.reminders();
    await this.put(REMINDERS_ENABLED, String(input.enabled), adminId);
    if (input.enabled && !before.enabled) {
      await this.put(REMINDERS_ENABLED_AT, now.toISOString(), adminId);
    }
    await this.put(PAYMENT_LINK, input.paymentLink ?? "", adminId);
    return this.reminders();
  }

  private async put(key: string, value: string, adminId: string) {
    await this.settings.upsert(
      { key, value, updatedById: adminId },
      { conflictPaths: ["key"] },
    );
  }
}
