import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { Driver } from "../driver.entity.js";
import { DriverNote } from "./driver-note.entity.js";
import { DriverNoteDto, DriverNoteListDto } from "./dto/driver-note.dto.js";

/**
 * Internal notes about a driver's account (Fleet revisions section 5), the same rules as the application notes (D57):
 * staff only, never on the statement; added and listed by any admin, never edited, and only their author may delete one.
 */
@Injectable()
export class DriverNotesService {
  constructor(
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(DriverNote)
    private readonly notes: Repository<DriverNote>,
  ) {}

  /**
   * One page of a driver's notes, newest first, each with its author's email (one LEFT JOIN, not one query per note).
   * `id` breaks ties so two notes written in the same millisecond keep their order across pages.
   * @throws NotFoundException unknown driver.
   */
  async list(
    driverId: string,
    query: PaginationQueryDto,
  ): Promise<DriverNoteListDto> {
    await this.assertDriverExists(driverId);
    const [rows, total] = await this.notes.findAndCount({
      where: { driverId },
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
   * Adds a note written by `adminId`. The body is already trimmed and checked by the DTO; the database CHECK refuses an
   * empty or over-long note too.
   * @throws NotFoundException unknown driver.
   */
  async add(
    driverId: string,
    body: string,
    adminId: string,
  ): Promise<DriverNoteDto> {
    await this.assertDriverExists(driverId);
    const saved = await this.notes.save(
      this.notes.create({ driverId, authorId: adminId, body }),
    );
    const withAuthor = await this.notes.findOneOrFail({
      where: { id: saved.id },
      relations: { author: true },
    });
    return this.toDto(withAuthor);
  }

  /**
   * Deletes a note. Only its author may: nobody can remove what another admin wrote.
   * @throws NotFoundException no such note on this driver.
   * @throws ForbiddenException the note was written by someone else.
   */
  async remove(
    driverId: string,
    noteId: string,
    adminId: string,
  ): Promise<void> {
    const note = await this.notes.findOneBy({ id: noteId, driverId });
    if (!note) throw new NotFoundException("Note not found.");
    if (note.authorId !== adminId) {
      throw new ForbiddenException("You can only delete your own notes.");
    }
    await this.notes.delete({ id: noteId });
  }

  private async assertDriverExists(id: string): Promise<void> {
    if (!(await this.drivers.existsBy({ id }))) {
      throw new NotFoundException("Driver not found.");
    }
  }

  /** Copies the response fields one by one, so nothing else (e.g. the author's password hash) can leak out. */
  private toDto(note: DriverNote): DriverNoteDto {
    return {
      id: note.id,
      body: note.body,
      authorId: note.authorId,
      authorEmail: note.author?.email ?? null,
      createdAt: note.createdAt,
    };
  }
}
