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
  CreateLedgerPresetDto,
  LedgerPresetDto,
  ReorderLedgerPresetsDto,
  UpdateLedgerPresetDto,
} from "./dto/ledger-preset.dto.js";
import { LedgerPresetsService } from "./ledger-presets.service.js";

/**
 * The quick-pick presets of the "New ledger entry" window (B86, D66), under `/ledger-presets`. Admin only (the global
 * guard).
 */
@Controller("ledger-presets")
export class LedgerPresetsController {
  constructor(private readonly presets: LedgerPresetsService) {}

  /** `GET /ledger-presets`: every preset, charges first, each kind in the order of its cards. */
  @Get()
  list(): Promise<LedgerPresetDto[]> {
    return this.presets.list();
  }

  /** `POST /ledger-presets`: adds a preset at the end of its kind. `400` bad amount or text; `409` name taken. */
  @Post()
  create(
    @Body() body: CreateLedgerPresetDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<LedgerPresetDto> {
    return this.presets.create(body, admin.id);
  }

  /**
   * `PUT /ledger-presets/order`: sets the order of one kind's cards (`kind`, `ids` = all that kind's ids). `400` the ids
   * are not exactly that kind's presets. Declared before `:id` so "order" is never read as an id.
   */
  @Put("order")
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() body: ReorderLedgerPresetsDto): Promise<void> {
    return this.presets.reorder(body.kind, body.ids);
  }

  /**
   * `PUT /ledger-presets/:id`: replaces a preset's name, amount and description (PUT because all three are replaced; the
   * amount may be null). `400` bad amount or text; `404` unknown id; `409` name taken.
   */
  @Put(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateLedgerPresetDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<LedgerPresetDto> {
    return this.presets.update(id, body, admin.id);
  }

  /** `DELETE /ledger-presets/:id`: `404` unknown id. Entries made from it keep their text and amount. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.presets.remove(id);
  }
}
