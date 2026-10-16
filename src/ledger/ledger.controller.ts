import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
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
