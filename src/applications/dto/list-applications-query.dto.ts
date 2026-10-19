import { IsEnum, IsOptional } from "class-validator";
import { DateRangeQueryDto } from "../../common/dto/date-range-query.dto.js";
import { ApplicationStatus } from "../application.entity.js";

/**
 * Query string of `GET /applications`, e.g. `?status=pending&search=pat&page=2&limit=8`.
 * `search` matches the name (first, last or both), email, city, and the phone by its digits.
 */
export class ListApplicationsQueryDto extends DateRangeQueryDto {
  /** Only applications with this status. Omit for all. */
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
