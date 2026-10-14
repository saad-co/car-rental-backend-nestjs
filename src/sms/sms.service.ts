import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import { Application } from "../applications/application.entity.js";
import { Driver } from "../drivers/driver.entity.js";
import { toUsE164 } from "../drivers/us-phone.js";
import type {
  SmsAttachmentDto,
  SmsFileListDto,
  SmsMessageDto,
  SmsMessageListDto,
  SmsStatusDto,
  SmsSyncResultDto,
} from "./dto/sms.dto.js";
import type { QuoClient, QuoMessage } from "./quo/quo-client.js";
import {
  describeQuoFailure,
  isTextableUsNumber,
} from "./quo/quo-failure-message.js";
import type { QuoMessageEvent } from "./quo/quo-webhook-event.js";
import { SmsAttachment, SmsAttachmentStatus } from "./sms-attachment.entity.js";
import { SmsContactKind } from "./sms-contact.js";
import {
  SMS_STATUS_RANK,
  SmsDirection,
  SmsMessage,
  SmsMode,
  SmsStatus,
} from "./sms-message.entity.js";
import { FILE_LINK_SECONDS, type FileStorage } from "./storage/file-storage.js";

/** Injection token for `SmsDeps`. */
export const SMS_DEPS = Symbol("SMS_DEPS");

/**
 * Everything `SmsService` needs from outside, built once by `SmsModule` from the settings (the same idea as
 * `EmailIntakeDeps`). The service never reads settings itself, so tests hand it fakes.
 */
export interface SmsDeps {
  /** What a text from the chat does (SMS_MODE). */
  mode: "off" | "dry_run" | "live";
  /** Null when no Quo API key is set: sending is then dry-run only and history cannot be synced. */
  quo: QuoClient | null;
  /** The one Quo number (`PN...`) the chat is for. Texts on other numbers are ignored (D51). */
  phoneNumberId: string | null;
  /** Null when no bucket is set: files stay `pending`. */
  storage: FileStorage | null;
  /** Quo API key, tried once on a file link that answers 401/403 (B57). */
  quoApiKey?: string | null;
  /** For tests of the file downloads. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Clock, for tests. */
  now?: () => Date;
}

/** Safety stop for one history sync (100 texts a page): a sync never loops forever. */
const MAX_SYNC_PAGES = 30;
/** A sync re-reads this far back from the newest stored text, to catch texts that arrived late. */
const SYNC_OVERLAP_MS = 5 * 60 * 1000;

/**
 * The texting chat (D50, D51): sends texts, stores every text with a contact (our sends, Quo's webhook, the
 * history sync) and lists them. A conversation is a contact's phone number, found from an application or driver.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SMS_DEPS) private readonly deps: SmsDeps,
  ) {}

  /** What the chat screen needs to know about the setup. */
  status(): SmsStatusDto {
    return {
      mode: this.deps.mode,
      quoConfigured: this.deps.quo !== null,
      filesConfigured: this.deps.storage !== null,
    };
  }

  // ---------------------------------------------------------------- contacts

  /**
   * The contact's phone (E.164) for an application or a driver. 404 if there is none; 400 if an application's
   * phone is not a US number we can text. Chat routes always go through this, so an admin can only text phones
   * that belong to an application or a driver, never a free-typed number.
   */
  async resolveContact(kind: SmsContactKind, id: string): Promise<string> {
    if (kind === SmsContactKind.drivers) {
      const driver = await this.dataSource.getRepository(Driver).findOne({
        where: { id },
        select: { id: true, phone: true },
      });
      if (!driver) throw new NotFoundException("Driver not found.");
      return driver.phone;
    }
    const application = await this.dataSource
      .getRepository(Application)
      .findOne({ where: { id }, select: { id: true, phone: true } });
    if (!application) throw new NotFoundException("Application not found.");
    const phone = toUsE164(application.phone);
    if (!phone)
      throw new BadRequestException(
        `This application's phone number (${application.phone}) is not a US number we can text.`,
      );
    return phone;
  }

  /**
   * True if the phone belongs to an application or a driver. The webhook stores a text only then (D51): the
   * general line also gets texts from customers and strangers, who are none of our business.
   */
  async isKnownContact(phone: string): Promise<boolean> {
    const driver = await this.dataSource
      .getRepository(Driver)
      .exists({ where: { phone } });
    if (driver) return true;
    // Applications keep the phone as the form sent it (ten digits, any punctuation).
    if (!/^\+1\d{10}$/.test(phone)) return false;
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM applications WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 LIMIT 1`,
      [phone.slice(2)],
    );
    return rows.length > 0;
  }

  // ----------------------------------------------------------------- sending

  /**
   * Sends a text to an application's or driver's phone, according to SMS_MODE.
   * `off`: refused (409), nothing stored. `dry_run`: saved as "composed", never sent. `live`: sent through Quo;
   * if Quo refuses, the failure is saved with its reason and the request fails with 502 (no silent failure).
   */
  async send(
    kind: SmsContactKind,
    id: string,
    text: string,
    adminId: string,
  ): Promise<SmsMessageDto> {
    const contactPhone = await this.resolveContact(kind, id);
    const { mode, quo } = this.deps;
    if (mode === "off")
      throw new ConflictException("Texting is switched off (SMS_MODE=off).");
    // Said before asking Quo, and nothing is saved: there is no text to show for a number that cannot get one.
    if (!isTextableUsNumber(contactPhone))
      throw new BadRequestException(
        `${contactPhone} is not a valid US phone number, so no text can be sent to it. Check the number on the ${kind === SmsContactKind.drivers ? "driver" : "application"}.`,
      );

    const messages = this.dataSource.getRepository(SmsMessage);

    if (mode === "dry_run") {
      const saved = await messages.save(
        messages.create({
          quoMessageId: null,
          direction: SmsDirection.outbound,
          contactPhone,
          body: text,
          mode: SmsMode.dry_run,
          status: SmsStatus.composed,
          error: null,
          sentById: adminId,
          occurredAt: this.now(),
        }),
      );
      return this.toMessageDto(await this.loadWithRelations(saved.id));
    }

    if (!quo)
      throw new ServiceUnavailableException(
        "Texting is live but the Quo API key is not set.",
      );

    let sent: QuoMessage;
    try {
      sent = await quo.sendText(contactPhone, text);
    } catch (error) {
      // The admin gets one plain sentence; the technical detail (Quo's own words) stays in the log.
      const technical = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Sending a text to ${contactPhone} failed: ${technical}`,
      );
      const friendly = describeQuoFailure(error);
      await messages.save(
        messages.create({
          quoMessageId: null,
          direction: SmsDirection.outbound,
          contactPhone,
          body: text,
          mode: SmsMode.live,
          status: SmsStatus.failed,
          error: friendly,
          sentById: adminId,
          occurredAt: this.now(),
        }),
      );
      throw new BadGatewayException(friendly);
    }

    const stored = await this.storeQuoMessage(sent, contactPhone, adminId);
    return this.toMessageDto(await this.loadWithRelations(stored.id));
  }

  // ----------------------------------------------------------------- reading

  /** One page of the chat with a contact, newest first. `before` is the previous page's `nextCursor`. */
  async listMessages(
    kind: SmsContactKind,
    id: string,
    limit: number,
    before: string | undefined,
  ): Promise<SmsMessageListDto> {
    const contactPhone = await this.resolveContact(kind, id);
    const query = this.dataSource
      .getRepository(SmsMessage)
      .createQueryBuilder("m")
      .leftJoinAndSelect("m.attachments", "a")
      .leftJoinAndSelect("m.sentBy", "u")
      .where("m.contact_phone = :contactPhone", { contactPhone })
      .orderBy("m.occurred_at", "DESC")
      .addOrderBy("m.id", "DESC")
      .addOrderBy("a.position", "ASC")
      .take(limit + 1);

    if (before) {
      const cursor = parseCursor(before);
      // Row comparison: "older than (time, id)", stable when two texts share a timestamp.
      query.andWhere("(m.occurred_at, m.id) < (:at, :cursorId)", {
        at: cursor.occurredAt,
        cursorId: cursor.id,
      });
    }

    const rows = await query.getMany();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((row) => this.toMessageDto(row))),
      nextCursor:
        rows.length > limit && last
          ? `${last.occurredAt.toISOString()}_${last.id}`
          : null,
      contactPhone,
    };
  }

  /** The files in the contact's conversation (the Files tab), newest first. */
  async listFiles(
    kind: SmsContactKind,
    id: string,
    page: number,
    limit: number,
  ): Promise<SmsFileListDto> {
    const contactPhone = await this.resolveContact(kind, id);
    const [rows, total] = await this.dataSource
      .getRepository(SmsAttachment)
      .createQueryBuilder("a")
      .innerJoinAndSelect("a.message", "m")
      .where("m.contact_phone = :contactPhone", { contactPhone })
      .orderBy("m.occurred_at", "DESC")
      .addOrderBy("a.position", "ASC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      items: await Promise.all(
        rows.map(async (row) => {
          const dto = await this.toAttachmentDto(row);
          return {
            id: dto.id,
            contentType: dto.contentType,
            sizeBytes: dto.sizeBytes,
            status: dto.status,
            url: dto.url,
            direction: row.message!.direction,
            occurredAt: row.message!.occurredAt,
          };
        }),
      ),
      total,
      page,
      limit,
    };
  }

  // -------------------------------------------------------------------- sync

  /**
   * Pulls the contact's history from Quo into our table, so texts sent from the Quo app (and anything the
   * webhook missed) show up. Only what is newer than our newest stored text (with a 5-minute overlap) is
   * fetched; the first sync reads everything. Re-running adds nothing twice (the Quo id is unique).
   */
  async syncConversation(
    kind: SmsContactKind,
    id: string,
  ): Promise<SmsSyncResultDto> {
    const contactPhone = await this.resolveContact(kind, id);
    const { quo } = this.deps;
    if (!quo)
      throw new ServiceUnavailableException(
        "Quo is not connected (no QUO_API_KEY or QUO_PHONE_NUMBER_ID), so the history cannot be synced.",
      );

    const newest = await this.dataSource
      .getRepository(SmsMessage)
      .createQueryBuilder("m")
      .select("MAX(m.occurred_at)", "newest")
      .where(
        "m.contact_phone = :contactPhone AND m.quo_message_id IS NOT NULL",
        {
          contactPhone,
        },
      )
      .getRawOne<{ newest: Date | null }>();
    const createdAfter = newest?.newest
      ? new Date(new Date(newest.newest).getTime() - SYNC_OVERLAP_MS)
      : undefined;

    let fetched = 0;
    let added = 0;
    let pageToken: string | undefined;
    for (let pages = 0; pages < MAX_SYNC_PAGES; pages++) {
      let page;
      try {
        page = await quo.listConversation(contactPhone, {
          createdAfter,
          pageToken,
        });
      } catch (error) {
        const technical =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Syncing ${contactPhone} from Quo failed: ${technical}`,
        );
        throw new BadGatewayException(describeQuoFailure(error));
      }
      for (const message of page.messages) {
        fetched++;
        const { created } = await this.storeQuoMessageWithFlag(
          message,
          contactPhone,
          null,
        );
        if (created) added++;
      }
      if (!page.nextPageToken) return { fetched, added };
      pageToken = page.nextPageToken;
    }
    this.logger.warn(
      `Sync of ${contactPhone} stopped after ${MAX_SYNC_PAGES} pages; the rest comes with the next sync.`,
    );
    return { fetched, added };
  }

  // ----------------------------------------------------------------- webhook

  /**
   * Applies one verified webhook event. Returns what it did, for the log. A text is stored only when it is on
   * our Quo number, is not a group text, and its contact is an application or a driver (D51).
   */
  async applyWebhookEvent(event: QuoMessageEvent): Promise<string> {
    // Without our number's id we cannot tell the general line from the other eight, so nothing is stored.
    if (!this.deps.phoneNumberId) {
      this.logger.error(
        "A Quo webhook arrived but QUO_PHONE_NUMBER_ID is not set; the text was not stored.",
      );
      return "skipped: QUO_PHONE_NUMBER_ID is not set";
    }
    if (event.phoneNumberId !== this.deps.phoneNumberId)
      return `skipped: other Quo number (${event.phoneNumberId ?? "none"})`;
    if (!event.contactPhone) return "skipped: group text";
    if (!/^\+[1-9]\d{6,14}$/.test(event.contactPhone))
      return `skipped: contact is not a phone number (${event.contactPhone})`;
    if (!(await this.isKnownContact(event.contactPhone)))
      return "skipped: contact is not an application or a driver";

    const { created } = await this.storeQuoMessageWithFlag(
      event.message,
      event.contactPhone,
      null,
    );
    return created
      ? `stored ${event.message.id}`
      : `updated ${event.message.id}`;
  }

  // ----------------------------------------------------------------- storing

  /** Stores a text from Quo (or updates the one we have). See `storeQuoMessageWithFlag`. */
  async storeQuoMessage(
    message: QuoMessage,
    contactPhone: string,
    sentById: string | null,
  ): Promise<SmsMessage> {
    return (await this.storeQuoMessageWithFlag(message, contactPhone, sentById))
      .row;
  }

  /**
   * The one place a text coming from Quo is saved. Idempotent: the Quo id is unique, so the same text seen
   * through a send, a webhook and a sync is one row. If it exists already, its status only moves forward
   * (late or duplicate webhooks never undo "delivered") and a missing sender is filled in. Its files are
   * recorded too (once per position).
   */
  private async storeQuoMessageWithFlag(
    message: QuoMessage,
    contactPhone: string,
    sentById: string | null,
  ): Promise<{ row: SmsMessage; created: boolean }> {
    const inbound = message.direction === "incoming";
    const status = inbound ? SmsStatus.received : toOutboundStatus(message);
    const error =
      status === SmsStatus.failed || status === SmsStatus.undelivered
        ? `Quo: ${message.errorCode ?? `text ${status}, no reason given`}`
        : null;

    return this.dataSource.transaction(async (manager) => {
      const messages = manager.getRepository(SmsMessage);
      const inserted = await messages
        .createQueryBuilder()
        .insert()
        .values({
          quoMessageId: message.id,
          direction: inbound ? SmsDirection.inbound : SmsDirection.outbound,
          contactPhone,
          body: message.text,
          mode: inbound ? null : SmsMode.live,
          status,
          error,
          sentById,
          occurredAt: message.createdAt,
        })
        .orIgnore()
        .returning("id")
        .execute();
      const created = inserted.raw.length > 0;

      const row = await messages.findOneByOrFail({ quoMessageId: message.id });
      if (!created) {
        const patch: Partial<SmsMessage> = {};
        if (SMS_STATUS_RANK[status] > SMS_STATUS_RANK[row.status]) {
          patch.status = status;
          patch.error = error;
        }
        if (sentById && !row.sentById) patch.sentById = sentById;
        if (Object.keys(patch).length > 0) {
          await messages.update(row.id, patch);
          Object.assign(row, patch);
        }
      }
      await this.recordAttachments(manager, row.id, message);
      return { row, created };
    });
  }

  private async recordAttachments(
    manager: EntityManager,
    messageId: string,
    message: QuoMessage,
  ): Promise<void> {
    if (message.media.length === 0) return;
    await manager
      .getRepository(SmsAttachment)
      .createQueryBuilder()
      .insert()
      .values(
        message.media.map((media, position) => ({
          messageId,
          position,
          sourceUrl: media.url,
          contentType: media.type,
          status: SmsAttachmentStatus.pending,
        })),
      )
      .orIgnore()
      .execute();
  }

  // ------------------------------------------------------------------ output

  private loadWithRelations(id: string): Promise<SmsMessage> {
    return this.dataSource.getRepository(SmsMessage).findOneOrFail({
      where: { id },
      relations: { attachments: true, sentBy: true },
    });
  }

  private async toMessageDto(row: SmsMessage): Promise<SmsMessageDto> {
    const attachments = [...(row.attachments ?? [])].sort(
      (a, b) => a.position - b.position,
    );
    return {
      id: row.id,
      direction: row.direction,
      body: row.body,
      mode: row.mode,
      status: row.status,
      error: row.error,
      sentByEmail: row.sentBy?.email ?? null,
      occurredAt: row.occurredAt,
      attachments: await Promise.all(
        attachments.map((attachment) => this.toAttachmentDto(attachment)),
      ),
    };
  }

  private async toAttachmentDto(
    attachment: SmsAttachment,
  ): Promise<SmsAttachmentDto> {
    const { storage } = this.deps;
    const canOpen =
      attachment.status === SmsAttachmentStatus.stored &&
      attachment.storageKey !== null &&
      storage !== null;
    return {
      id: attachment.id,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      status: attachment.status,
      url: canOpen
        ? await storage.presignGet(attachment.storageKey!, FILE_LINK_SECONDS)
        : null,
    };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** An outbound text's status from Quo; `received` makes no sense for one we sent, so it is an error. */
function toOutboundStatus(message: QuoMessage): SmsStatus {
  if (message.status === "received")
    throw new Error(
      `Quo gave outgoing text ${message.id} the status "received".`,
    );
  return message.status as SmsStatus;
}

/** Reads a `before` cursor (`<ISO time>_<uuid>`); 400 if it is not one we made. */
function parseCursor(cursor: string): { occurredAt: Date; id: string } {
  const [time, id] = cursor.split("_");
  const occurredAt = new Date(time ?? "");
  if (Number.isNaN(occurredAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? ""))
    throw new BadRequestException("Invalid 'before' cursor.");
  return { occurredAt, id: id! };
}
