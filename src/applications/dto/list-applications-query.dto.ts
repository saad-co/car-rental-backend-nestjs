import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsOptional } from "class-validator";
import {
  ArchivedQueryDto,
  queryBoolean,
} from "../../common/dto/archived-query.dto.js";
import { ApplicationStatus } from "../application.entity.js";

/**
 * Query string of `GET /applications`, e.g. `?status=pending&search=pat&page=2&limit=8&archived=true`.
 * `search` matches the name (first, last or both), email, city, and the phone by its digits.
 * `archived=true` shows only archived applications; otherwise they are hidden (D80). Applications whose person is
 * already an active or inactive driver are hidden too, unless `becameDriver=true` asks for exactly those (D84).
 */
export class ListApplicationsQueryDto extends ArchivedQueryDto {
  /** Only applications with this status. Omit for all. */
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  /** `true` = only applications whose driver is active or inactive (D84). Not together with `archived=true`. */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  becameDriver?: boolean;
}
