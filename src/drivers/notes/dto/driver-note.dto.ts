import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";
import { MAX_DRIVER_NOTE_LENGTH } from "../driver-note.entity.js";

/** Body of `POST /drivers/:id/notes`. */
export class CreateDriverNoteDto {
  /**
   * The note, 1 to 2000 characters after trimming; line breaks are kept. `@Transform` trims it before the checks, so
   * a note of only spaces is refused (400) instead of saved empty.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: "The note is empty." })
  @MaxLength(MAX_DRIVER_NOTE_LENGTH)
  body: string;
}

/** One internal note, as the driver's ledger page shows it. */
export class DriverNoteDto {
  id: string;
  body: string;
  /** The admin who wrote it; null if that account was removed since. */
  authorId: string | null;
  /** The author's email, shown as their name (admins have no name field). Null if the account was removed. */
  authorEmail: string | null;
  createdAt: Date;
}

/** One page of a driver's notes, newest first. */
export class DriverNoteListDto {
  items: DriverNoteDto[];
  /** All notes of the driver, across pages. */
  total: number;
  page: number;
  limit: number;
}
