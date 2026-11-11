import { Transform } from "class-transformer";
import { IsISO8601, IsOptional, Matches } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";

/** Turns an empty or blank `?from=` into undefined, so it means "no limit" instead of failing the checks. */
const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() || undefined : value;

/**
 * `?from=&to=` on top of paging, for the Page 2 lists (D93). Whole Chicago calendar days, `YYYY-MM-DD`, inclusive, either
 * can be left out. Same rules as `DateRangeQueryDto`, which also carries a search box these lists do not have.
 */
export class DayRangeQueryDto extends PaginationQueryDto {
  /** First day to include, e.g. `2026-10-01`. */
  @IsOptional()
  @Transform(blankToUndefined)
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
