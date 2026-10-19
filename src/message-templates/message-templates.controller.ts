import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import {
  CreateMessageTemplateDto,
  MessageTemplateDto,
  UpdateMessageTemplateDto,
} from "./dto/message-template.dto.js";
import { MessageTemplatesService } from "./message-templates.service.js";

/**
 * Text templates for the Settings page and the Approve / Decline dialogs (B73, B81), under `/message-templates`.
 * Admin only (the global guard).
 */
@Controller("message-templates")
export class MessageTemplatesController {
  constructor(private readonly templates: MessageTemplatesService) {}

  /** `GET /message-templates`: every template, grouped by kind, with its placeholders and last edit. */
  @Get()
  list(): Promise<MessageTemplateDto[]> {
    return this.templates.list();
  }

  /** `POST /message-templates`: adds a template. `400` empty, too long or unknown placeholder; `409` name taken. */
  @Post()
  create(
    @Body() body: CreateMessageTemplateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MessageTemplateDto> {
    return this.templates.create(body.kind, body.name, body.body, admin.id);
  }

  /**
   * `PUT /message-templates/:id`: replaces a template's name and text. PUT because both are replaced. `400` empty,
   * too long or unknown placeholder; `404` unknown id; `409` name taken.
   */
  @Put(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateMessageTemplateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MessageTemplateDto> {
    return this.templates.update(id, body.name, body.body, admin.id);
  }

  /** `DELETE /message-templates/:id`: `404` unknown id; `409` if it is the last template of its kind. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.templates.remove(id);
  }
}
