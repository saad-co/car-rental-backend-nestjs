import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { ApplicationStatus } from "../application.entity.js";

/**
 * Query string of `GET /applications`, e.g. `?status=pending&page=2&limit=20`.
 *
 * Query string values always arrive as text. `@Type(() => Number)` converts `"2"` to `2`
 * before the checks run (the global ValidationPipe has `transform: true`). A missing value
 * keeps the default written here.
 */
export class ListApplicationsQueryDto {
  /** Only applications with this status. Omit for all. */
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  /** Page number, starting at 1. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Applications per page (1 to 100). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
