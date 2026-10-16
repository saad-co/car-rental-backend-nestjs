import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { PaginationQueryDto } from "./pagination-query.dto.js";

/**
 * `?page=&limit=&search=` for lists with a search box (B75). Feature query DTOs extend this instead of
 * PaginationQueryDto when they can be searched.
 *
 * `@Transform` runs before the checks: the text is trimmed, and an empty search (`?search=` or only spaces) becomes
 * undefined, so it means "no search" instead of matching everything with `%%`.
 */
export class SearchQueryDto extends PaginationQueryDto {
  /** Text to look for; which fields are searched depends on the list. Case does not matter. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
}
