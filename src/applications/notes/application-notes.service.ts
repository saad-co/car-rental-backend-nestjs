import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Application } from "../application.entity.js";
import { ApplicationNote } from "./application-note.entity.js";
import {
  ApplicationNoteDto,
  ApplicationNoteListDto,
} from "./dto/application-note.dto.js";

/**
 * Internal notes on applications (B74, D57): staff only, never sent to the applicant. Notes are added and listed by
 * any admin; they are never edited, and only their author may delete one.
 */
@Injectable()
export class ApplicationNotesService {
  constructor(
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(ApplicationNote)
    private readonly notes: Repository<ApplicationNote>,
  ) {}

  /**
   * One page of an application's notes, newest first, each with its author's email (one LEFT JOIN, not one query
   * per note). `id` breaks ties so two notes written in the same millisecond keep their order across pages.
   * @throws NotFoundException unknown application.
   */
  async list(
    applicationId: string,
    query: PaginationQueryDto,
  ): Promise<ApplicationNoteListDto> {
    await this.assertApplicationExists(applicationId);
    const [rows, total] = await this.notes.findAndCount({
      where: { applicationId },
      relations: { author: true },
      order: { createdAt: "DESC", id: "DESC" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Adds a note written by `adminId`. The body is already trimmed and checked by the DTO; the database CHECK
   * refuses an empty or over-long note too.
   * @throws NotFoundException unknown application.
   */
  async add(
    applicationId: string,
    body: string,
    adminId: string,
  ): Promise<ApplicationNoteDto> {
    await this.assertApplicationExists(applicationId);
    const saved = await this.notes.save(
      this.notes.create({ applicationId, authorId: adminId, body }),
    );
    const withAuthor = await this.notes.findOneOrFail({
      where: { id: saved.id },
      relations: { author: true },
    });
    return this.toDto(withAuthor);
  }

  /**
   * Deletes a note. Only its author may: nobody can remove what another admin wrote (D57).
   * @throws NotFoundException no such note on this application.
   * @throws ForbiddenException the note was written by someone else.
   */
  async remove(
    applicationId: string,
    noteId: string,
    adminId: string,
  ): Promise<void> {
    const note = await this.notes.findOneBy({ id: noteId, applicationId });
    if (!note) throw new NotFoundException("Note not found.");
    if (note.authorId !== adminId) {
      throw new ForbiddenException("You can only delete your own notes.");
    }
    await this.notes.delete({ id: noteId });
  }

  private async assertApplicationExists(id: string): Promise<void> {
    if (!(await this.applications.existsBy({ id }))) {
      throw new NotFoundException("Application not found.");
    }
  }

  /** Copies the response fields one by one, so nothing else (e.g. the author's password hash) can leak out. */
  private toDto(note: ApplicationNote): ApplicationNoteDto {
    return {
      id: note.id,
      body: note.body,
      authorId: note.authorId,
      authorEmail: note.author?.email ?? null,
      createdAt: note.createdAt,
    };
  }
}
