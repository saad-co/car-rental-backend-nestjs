import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { AppSetting } from "./app-setting.entity.js";

const REMINDERS_ENABLED = "reminders_enabled";
const REMINDERS_ENABLED_AT = "reminders_enabled_at";
const PAYMENT_LINK = "payment_link";
const INSPECTION_LINK_HOURS = "inspection_link_hours";
/** The shortest a vehicle-photo link may work (Abulkalam, 2026-11-17, D112). */
export const MIN_INSPECTION_LINK_HOURS = 72;

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

  /**
   * How many hours a vehicle-photo link works after it is sent or issued (Module 3, D102). 72 hours, the minimum Abulkalam set on
   * 2026-11-17 (D112; it was 24); the `inspection_link_hours` row can make it longer, never shorter. There is no screen for it.
   */
  async inspectionLinkHours(): Promise<number> {
    const row = await this.settings.findOneBy({ key: INSPECTION_LINK_HOURS });
    const hours = Number(row?.value);
    return Number.isInteger(hours) && hours > MIN_INSPECTION_LINK_HOURS
      ? hours
      : MIN_INSPECTION_LINK_HOURS;
  }

  private async put(key: string, value: string, adminId: string) {
    await this.settings.upsert(
      { key, value, updatedById: adminId },
      { conflictPaths: ["key"] },
    );
  }
}
