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
import {
  LedgerEntryDetailsDto,
  LedgerListQueryDto,
  LedgerOverviewDto,
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
 * A driver's ledger (D60), under `/drivers/:id/ledger`. Admin only (the global guard; no decorator needed).
 * Express equivalent: a router mounted at `/drivers/:id/ledger` behind the app-wide auth middleware; the DTO classes
 * replace a validation middleware (the global ValidationPipe checks the body before the handler runs).
 */
@Controller("drivers/:id/ledger")
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * `GET /drivers/:id/ledger`: one page of entries, each with the balance after it, plus the balance now and the
   * totals of the filtered entries. Filters: `type`, `from`, `to`, `search` (text or a reference like `CH-1042`);
   * `order=asc|desc` (default newest first). `400` bad dates or `from` after `to`; `404` unknown driver.
   */
  @Get()
  list(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: LedgerListQueryDto,
  ): Promise<LedgerPageDto> {
    return this.ledger.listPage(id, query);
  }

  /**
   * `GET /drivers/:id/ledger/overview`: the balance, what is owed by age of the charges (0–6, 7–13, 14–29, 30+ days)
   * and the newest confirmed payment. `404` unknown driver.
   */
  @Get("overview")
  overview(@Param("id", ParseUUIDPipe) id: string): Promise<LedgerOverviewDto> {
    return this.ledger.overview(id);
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
   * `GET /drivers/:id/ledger/entries/:entryId`: one entry with what it reverses or was reversed by, the charge it
   * is applied against, the credits applied against it and its payment. `404` no such entry on this driver.
   */
  @Get("entries/:entryId")
  details(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
  ): Promise<LedgerEntryDetailsDto> {
    return this.ledger.entryDetails(id, entryId);
  }

  /**
   * `POST /drivers/:id/ledger/entries`: adds a manual charge or credit (late fee, flat tire, discount, …), or a
   * credit applied against a charge (`appliesToId`). `201` the entry (also when the same `requestKey` is sent
   * again); `400` invalid amount, date or direction, or more than is left on the charge; `404` unknown driver or
   * charge; `409` the key reused for a different entry.
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
   * `404` no such entry on this driver; `409` a payment credit, a reversal, reversed already, or a charge that
   * still has credits applied.
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
