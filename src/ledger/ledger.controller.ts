import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto.js";
import {
  LedgerPageDto,
  LedgerSummaryDto,
  LedgerSummaryQueryDto,
} from "./dto/ledger-read.dto.js";
import {
  CreateLedgerEntryDto,
  LedgerEntryDto,
  ReverseLedgerEntryDto,
} from "./dto/ledger-entry.dto.js";
import { LedgerService } from "./ledger.service.js";

/**
 * A driver's ledger (D58), under `/drivers/:id/ledger`. Admin only (the global guard; no decorator needed).
 * Express equivalent: a router mounted at `/drivers/:id/ledger` behind the app-wide auth middleware; the DTO classes
 * replace a validation middleware (the global ValidationPipe checks the body before the handler runs).
 */
@Controller("drivers/:id/ledger")
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * `GET /drivers/:id/ledger`: one page of entries, newest first, each with the balance after it, plus the
   * balance now. `404` unknown driver.
   */
  @Get()
  list(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<LedgerPageDto> {
    return this.ledger.listPage(id, query);
  }

  /**
   * `GET /drivers/:id/ledger/summary?period=week|month`: totals per week (Monday to Sunday) or month, newest
   * first, empty periods included. `400` bad dates or more than 104 periods; `404` unknown driver.
   */
  @Get("summary")
  summary(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: LedgerSummaryQueryDto,
  ): Promise<LedgerSummaryDto> {
    return this.ledger.summary(id, query);
  }

  /**
   * `POST /drivers/:id/ledger/entries`: adds a manual charge or credit (late fee, flat tire, discount, …).
   * `201` the entry (also when the same `requestKey` is sent again); `400` invalid amount, date or direction;
   * `404` unknown driver; `409` a second opening balance, or the key reused for a different entry.
   */
  @Post("entries")
  addEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateLedgerEntryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<LedgerEntryDto> {
    return this.ledger.addManualEntry(id, body, admin.id);
  }

  /**
   * `POST /drivers/:id/ledger/entries/:entryId/reverse`: cancels an entry with a reversal. `201` the reversal;
   * `404` no such entry on this driver; `409` a payment credit, a reversal, or reversed already.
   */
  @Post("entries/:entryId/reverse")
  reverse(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
    @Body() body: ReverseLedgerEntryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<LedgerEntryDto> {
    return this.ledger.reverse(id, entryId, body.reason, admin.id);
  }
}
