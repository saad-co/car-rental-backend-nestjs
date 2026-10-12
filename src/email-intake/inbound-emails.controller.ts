import { Controller, Get, Query } from "@nestjs/common";
import { InboundEmailListDto } from "./dto/inbound-email.dto.js";
import { ListInboundEmailsQueryDto } from "./dto/list-inbound-emails-query.dto.js";
import { InboundEmailsService } from "./inbound-emails.service.js";

/** The admin email log under `/inbound-emails`. All need a logged-in admin (global JwtAuthGuard). */
@Controller("inbound-emails")
export class InboundEmailsController {
  constructor(private readonly emails: InboundEmailsService) {}

  /** `GET /inbound-emails`: one page of processed emails with their outcome, newest first. */
  @Get()
  list(
    @Query() query: ListInboundEmailsQueryDto,
  ): Promise<InboundEmailListDto> {
    return this.emails.list(query);
  }
}
