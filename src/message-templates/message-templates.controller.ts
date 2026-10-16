import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import {
  MessageTemplateDto,
  UpdateMessageTemplateDto,
} from "./dto/message-template.dto.js";
import { TemplateKey } from "./message-template.entity.js";
import { MessageTemplatesService } from "./message-templates.service.js";

/** Text templates for the Settings page (B73), under `/message-templates`. Admin only (the global guard). */
@Controller("message-templates")
export class MessageTemplatesController {
  constructor(private readonly templates: MessageTemplatesService) {}

  /** `GET /message-templates`: every template with its placeholders and last edit. */
  @Get()
  list(): Promise<MessageTemplateDto[]> {
    return this.templates.list();
  }

  /**
   * `PUT /message-templates/:key`: replaces a template's text. PUT because the whole text is replaced. `400` empty,
   * too long, unknown placeholder, or a key that is not a template (`ParseEnumPipe`).
   */
  @Put(":key")
  update(
    @Param("key", new ParseEnumPipe(TemplateKey)) key: TemplateKey,
    @Body() body: UpdateMessageTemplateDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<MessageTemplateDto> {
    return this.templates.update(key, body.body, admin.id);
  }
}
