import { SmsDirection, SmsMode, SmsStatus } from "../sms-message.entity.js";
import { SmsAttachmentStatus } from "../sms-attachment.entity.js";

/** A file that came with a text. */
export class SmsAttachmentDto {
  id: string;
  /** MIME type, e.g. `image/jpeg`; null if unknown. */
  contentType: string | null;
  sizeBytes: number | null;
  /** `stored` files can be opened; `pending` ones are still being copied; `failed` ones never will be. */
  status: SmsAttachmentStatus;
  /** Short-lived link to open the file (about 10 minutes). Null unless `stored`. */
  url: string | null;
}

/** One text in the chat. */
export class SmsMessageDto {
  id: string;
  direction: SmsDirection;
  /** The words; empty for a text that is only a file. */
  body: string;
  /** Null for inbound texts. `dry_run` texts were never sent. */
  mode: SmsMode | null;
  status: SmsStatus;
  /** Why it failed, when it did. */
  error: string | null;
  /** The admin who sent it from this app; null for inbound texts and texts sent from the Quo app. */
  sentByEmail: string | null;
  /** When it happened (Quo's time). */
  occurredAt: Date;
  attachments: SmsAttachmentDto[];
}

/** One page of the chat, newest text first. */
export class SmsMessageListDto {
  items: SmsMessageDto[];
  /** Pass as `before` to get the next, older page. Null when there is nothing older. */
  nextCursor: string | null;
  /** The contact's number the chat is with (E.164). */
  contactPhone: string;
}

/** One file in the Files tab. */
export class SmsFileDto extends SmsAttachmentDto {
  /** Who sent it: `inbound` = the contact texted it to us. */
  direction: SmsDirection;
  occurredAt: Date;
}

export class SmsFileListDto {
  items: SmsFileDto[];
  total: number;
  page: number;
  limit: number;
}

/** What the chat needs to know about the setup. */
export class SmsStatusDto {
  /** `off`: sending refused. `dry_run`: texts are saved, not sent. `live`: really sent. */
  mode: "off" | "dry_run" | "live";
  /** Whether the Quo API key and number are set, which syncing the history needs. */
  quoConfigured: boolean;
  /** Whether the file bucket is set; without it files stay pending. */
  filesConfigured: boolean;
}

/** What a history sync did. */
export class SmsSyncResultDto {
  /** Texts Quo returned. */
  fetched: number;
  /** Of those, how many were new to us. */
  added: number;
}
