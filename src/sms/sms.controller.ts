import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { AttachmentDownloader } from "./attachments/attachment-downloader.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { ListSmsQueryDto } from "./dto/list-sms-query.dto.js";
import { SendSmsDto } from "./dto/send-sms.dto.js";
import {
  SmsFileListDto,
  SmsMessageDto,
  SmsMessageListDto,
  SmsStatusDto,
  SmsSyncResultDto,
} from "./dto/sms.dto.js";
import { SmsContactKind } from "./sms-contact.js";
import { SmsService } from "./sms.service.js";

/**
 * Admin chat routes under `/sms` (D50). `:kind` is `applications` or `drivers` and `:id` that record's id: the
 * contact's phone is looked up from it, so an admin can only text phones that belong to an application or a
 * driver. All need a logged-in admin (global JwtAuthGuard).
 */
@Controller("sms")
export class SmsController {
  constructor(
    private readonly sms: SmsService,
    private readonly attachments: AttachmentDownloader,
  ) {}

  /** `GET /sms/status`: SMS mode and what is connected. */
  @Get("status")
  status(): SmsStatusDto {
    return this.sms.status();
  }

  /** `GET /sms/:kind/:id/messages`: one page of the chat, newest first. */
  @Get(":kind/:id/messages")
  list(
    @Param("kind", new ParseEnumPipe(SmsContactKind)) kind: SmsContactKind,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListSmsQueryDto,
  ): Promise<SmsMessageListDto> {
    return this.sms.listMessages(kind, id, query.limit, query.before);
  }

  /**
   * `POST /sms/:kind/:id/messages`: sends a text, according to SMS_MODE.
   * `409` texting is off, `502` Quo refused (the failure is saved and shown in the chat),
   * `400` the application's phone is not a US number, `404` unknown record.
   */
  @Post(":kind/:id/messages")
  send(
    @Param("kind", new ParseEnumPipe(SmsContactKind)) kind: SmsContactKind,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SendSmsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<SmsMessageDto> {
    return this.sms.send(kind, id, body.text, admin.id);
  }

  /** `POST /sms/:kind/:id/sync`: pulls this contact's history from Quo (texts sent from the Quo app too). */
  @Post(":kind/:id/sync")
  @HttpCode(HttpStatus.OK)
  async sync(
    @Param("kind", new ParseEnumPipe(SmsContactKind)) kind: SmsContactKind,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SmsSyncResultDto> {
    const result = await this.sms.syncConversation(kind, id);
    // Files the sync found are copied right away, without making the chat wait.
    if (result.added > 0) this.attachments.runInBackground();
    return result;
  }

  /** `GET /sms/:kind/:id/files`: the files in this contact's conversation, newest first. */
  @Get(":kind/:id/files")
  files(
    @Param("kind", new ParseEnumPipe(SmsContactKind)) kind: SmsContactKind,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<SmsFileListDto> {
    return this.sms.listFiles(kind, id, query.page, query.limit);
  }
}
