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
import { ApplicationNotesService } from "./application-notes.service.js";
import {
  ApplicationNoteDto,
  ApplicationNoteListDto,
  CreateApplicationNoteDto,
} from "./dto/application-note.dto.js";

/**
 * Internal notes on an application (B74, D57), under `/applications/:id/notes`. Admin only (the global guard).
 * Express equivalent: a router mounted at `/applications/:id/notes`, with the auth middleware applied app-wide.
 */
@Controller("applications/:id/notes")
export class ApplicationNotesController {
  constructor(private readonly notes: ApplicationNotesService) {}

  /** `GET /applications/:id/notes`: one page of notes, newest first. `404` unknown application. */
  @Get()
  list(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ApplicationNoteListDto> {
    return this.notes.list(id, query);
  }

  /** `POST /applications/:id/notes`: adds a note by the logged-in admin. `400` empty or too long. */
  @Post()
  add(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateApplicationNoteDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationNoteDto> {
    return this.notes.add(id, body.body, admin.id);
  }

  /**
   * `DELETE /applications/:id/notes/:noteId`: deletes one of your own notes. `204` with no body; `403` someone
   * else's note; `404` unknown note.
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
