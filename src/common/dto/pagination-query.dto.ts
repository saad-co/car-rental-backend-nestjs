import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

/**
 * `?page=&limit=` for every paginated list. Feature query DTOs extend this class and add
 * their own filters, so the paging rules are written once.
 *
 * Query string values always arrive as text. `@Type(() => Number)` converts `"2"` to `2`
 * before the checks run (the global ValidationPipe has `transform: true`). A missing value
 * keeps the default written here.
 */
export class PaginationQueryDto {
  /** Page number, starting at 1. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Items per page (1 to 100). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
