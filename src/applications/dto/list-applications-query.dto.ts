import { IsEnum, IsOptional } from "class-validator";
import { ArchivedQueryDto } from "../../common/dto/archived-query.dto.js";
import { ApplicationStatus } from "../application.entity.js";

/**
 * Query string of `GET /applications`, e.g. `?status=pending&search=pat&page=2&limit=8&archived=true`.
 * `search` matches the name (first, last or both), email, city, and the phone by its digits.
 * `archived=true` shows only archived applications; otherwise they are hidden (D80).
 */
export class ListApplicationsQueryDto extends ArchivedQueryDto {
  /** Only applications with this status. Omit for all. */
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
