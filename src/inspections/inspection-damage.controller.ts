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
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { CreateLedgerEntryDto } from "../ledger/dto/ledger-entry.dto.js";
import {
  ChargeDamageItemResultDto,
  CreateDamageItemDto,
  DamageItemDto,
  InspectionCompareDto,
} from "./dto/inspection.dto.js";
import { InspectionDamageService } from "./inspection-damage.service.js";

/**
 * Staff routes to compare a check-out with its check-in, mark new damage and charge it (Module 3 chat 2, D110). Admin only
 * (the global guard). Express comparison: a router mounted at `/inspections/:id/...` and `/damage-items/:id/...`.
 */
@Controller()
export class InspectionDamageController {
  constructor(private readonly damage: InspectionDamageService) {}

  /**
   * `GET /inspections/:id/compare`: the check-out beside its check-in (19 pairs, miles, fuel, damage). `available: false` with
   * a `reason` when there is nothing to compare. `404` unknown.
   */
  @Get("inspections/:id/compare")
  compare(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<InspectionCompareDto> {
    return this.damage.compare(id);
  }

  /**
   * `POST /inspections/:id/damage-items`: "New damage" on one check-out photo; flags the inspection. `404` unknown inspection or
   * photo; `409` not a submitted, paired check-out, or the photo is already marked.
   */
  @Post("inspections/:id/damage-items")
  mark(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateDamageItemDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DamageItemDto> {
    return this.damage.mark(id, body, admin.id);
  }

  /** `DELETE /damage-items/:id`: back to "No change". `404` unknown; `409` already charged. */
  @Delete("damage-items/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  unmark(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    return this.damage.unmark(id, admin.id);
  }

  /**
   * `POST /damage-items/:id/charge`: charges the driver for the damage (one ledger debit; the body is the same as a manual
   * ledger entry and `direction` must be `debit`). Sending the same `requestKey` again returns the same entry. `400` not a
   * debit or the ledger refused it; `404` unknown; `409` already charged.
   */
  @Post("damage-items/:id/charge")
  @HttpCode(HttpStatus.OK)
  charge(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateLedgerEntryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ChargeDamageItemResultDto> {
    return this.damage.charge(id, body, admin.id);
  }
}
