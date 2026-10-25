import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { DateRangeQueryDto } from "./date-range-query.dto.js";

/**
 * Turns the query-string text `true` / `false` into a real boolean before the checks run. A query string is always
 * text, and the global ValidationPipe does not convert types by itself, so `?archived=false` would otherwise be the
 * (truthy) string "false". Anything else is left as it is and fails `@IsBoolean()` with a 400.
 */
export const queryBoolean = ({ value }: { value: unknown }) =>
  value === "true" ? true : value === "false" ? false : value;

/**
 * `?archived=` on top of paging, search and the date range, for the lists that can be archived (D80). Left out or
 * `false`: only what is not archived (the normal list). `true`: only what is archived.
 */
export class ArchivedQueryDto extends DateRangeQueryDto {
  /** `true` = only archived, otherwise only not archived. */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived?: boolean;
}
