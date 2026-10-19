import { Transform } from "class-transformer";
import { IsISO8601, IsOptional, Matches } from "class-validator";
import { SearchQueryDto } from "./search-query.dto.js";

/** Turns an empty or blank `?from=` into undefined, so it means "no limit" instead of failing the checks. */
const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() || undefined : value;

/**
 * `?from=&to=` on top of paging and search, for lists with a date filter (B82). Both are whole calendar days,
 * `YYYY-MM-DD`, inclusive, in the business's time zone (America/Chicago, the same zone every time on screen is
 * shown in). Either can be left out for an open end. `from` later than `to` is refused with 400 by `addDateRange`.
 */
export class DateRangeQueryDto extends SearchQueryDto {
  /** First day to include, e.g. `2026-10-01`. */
  @IsOptional()
  @Transform(blankToUndefined)
  // `strict` rejects days that do not exist (2026-02-30); the pattern rejects timestamps and other formats.
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "from must be YYYY-MM-DD" })
  from?: string;

  /** Last day to include, e.g. `2026-10-15` (the whole day counts). */
  @IsOptional()
  @Transform(blankToUndefined)
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "to must be YYYY-MM-DD" })
  to?: string;
}
