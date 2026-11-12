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
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../../auth/jwt-auth.guard.js";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import {
  CreateDriverNoteDto,
  DriverNoteDto,
  DriverNoteListDto,
} from "./dto/driver-note.dto.js";
import { DriverNotesService } from "./driver-notes.service.js";

/**
 * Internal notes about a driver's account, under `/drivers/:id/notes` (Fleet revisions section 5). Admin only (the global
 * guard). Express equivalent: a router mounted at `/drivers/:id/notes`, with the auth middleware applied app-wide.
 */
@Controller("drivers/:id/notes")
export class DriverNotesController {
  constructor(private readonly notes: DriverNotesService) {}

  /** `GET /drivers/:id/notes`: one page of notes, newest first. `404` unknown driver. */
  @Get()
  list(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<DriverNoteListDto> {
    return this.notes.list(id, query);
  }

  /** `POST /drivers/:id/notes`: adds a note by the logged-in admin. `400` empty or too long; `404` unknown driver. */
  @Post()
  add(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateDriverNoteDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverNoteDto> {
    return this.notes.add(id, body.body, admin.id);
  }

  /**
   * `DELETE /drivers/:id/notes/:noteId`: deletes one of your own notes. `204` with no body; `403` someone else's note;
   * `404` unknown note.
   */
  @Delete(":noteId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("noteId", ParseUUIDPipe) noteId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<void> {
    return this.notes.remove(id, noteId, admin.id);
  }
}
