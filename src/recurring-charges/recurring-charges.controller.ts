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
import {
  CreateRecurringChargeDto,
  DriverRecurringChargeDto,
  RecurringChargeDto,
} from "./dto/recurring-charge.dto.js";
import { RecurringChargesService } from "./recurring-charges.service.js";

/**
 * The rent set and changed by hand, under `/drivers/:id/recurring-charge` (D100, D101). Admin only (the global guard). Express
 * equivalent: a router mounted at that path, with the auth middleware applied app-wide.
 */
@Controller("drivers/:id/recurring-charge")
export class RecurringChargesController {
  constructor(private readonly charges: RecurringChargesService) {}

  /**
   * `GET /drivers/:id/recurring-charge`: the rent in force (or the next one waiting) and every rent set by hand, newest first.
   * `404` unknown driver.
   */
  @Get()
  get(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<DriverRecurringChargeDto> {
    return this.charges.get(id);
  }

  /**
   * `POST /drivers/:id/recurring-charge`: "rent from a date". Sets the first rent of a driver with no contract or changes the
   * rent of any driver (a charge set by hand or a signed contract). It starts on the first due day on or after the latest of the
   * date given, today and the day after the last rent already posted; a rent that has not started yet is replaced; rent entries
   * already on the ledger stay as they are. `400` bad body; `404` unknown driver; `409` archived.
   */
  @Post()
  setRent(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateRecurringChargeDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<RecurringChargeDto> {
    return this.charges.setRent(id, body, admin.id);
  }

  /**
   * `DELETE /drivers/:id/recurring-charge/:chargeId`: removes a rent that has not started yet. `204` with no body; `404` unknown
   * driver or rent; `409` the rent has already started.
   */
  @Delete(":chargeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("chargeId", ParseUUIDPipe) chargeId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    return this.charges.remove(id, chargeId, admin.id);
  }
}
