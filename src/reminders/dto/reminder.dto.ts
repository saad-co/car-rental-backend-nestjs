import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";
import { ReminderStatus } from "../reminder-log.entity.js";
import { ReminderKind } from "../reminder-rules.js";

/** One reminder in a driver's record (what staff see under "Reminders"). */
export class ReminderLogDto {
  id: string;
  @ApiProperty({ enum: ReminderKind, enumName: "ReminderKind" })
  kind: ReminderKind;
  /** For a high-balance reminder: how many payments behind. */
  tier: number | null;
  /** `live`: really texted. `dry_run`: composed and saved only. */
  mode: "dry_run" | "live";
  @ApiProperty({ enum: ReminderStatus, enumName: "ReminderStatus" })
  status: ReminderStatus;
  /** Why a send failed, in plain words; null unless `failed`. */
  error: string | null;
  /** The text as composed. */
  body: string;
  /** What was past due when it was composed, in cents. */
  pastDueCents: number;
  /** The ledger balance when it was composed, in cents. */
  balanceCents: number;
  createdAt: Date;
}

/** One page of a driver's reminders, newest first. */
export class ReminderLogListDto {
  items: ReminderLogDto[];
  total: number;
  page: number;
  limit: number;
}

/** The payment-reminder settings with what staff need to know about texting. */
export class ReminderSettingsDto {
  /** The master switch for all automatic reminders. Off until turned on. */
  enabled: boolean;
  /** When it was last turned on; null if never. */
  enabledAt: Date | null;
  /** Where drivers pay: put in the texts as `{paymentLink}`; null = none (the line with it is left out). */
  paymentLink: string | null;
  /** How texting is set up on the server: `off` composes nothing, `dry_run` only saves texts, `live` sends them. */
  smsMode: "off" | "dry_run" | "live";
  /** Whether a Quo key is set (needed for `live`). */
  quoConfigured: boolean;
}

/** Body of `PUT /settings/reminders`. */
export class UpdateReminderSettingsDto {
  @IsBoolean()
  enabled: boolean;

  /** An http or https address, up to 300 characters; empty or null clears it. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(300)
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  paymentLink?: string | null;
}
