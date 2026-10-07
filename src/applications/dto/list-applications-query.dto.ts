import { IsEnum, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { ApplicationStatus } from "../application.entity.js";

/** Query string of `GET /applications`, e.g. `?status=pending&page=2&limit=20`. */
export class ListApplicationsQueryDto extends PaginationQueryDto {
  /** Only applications with this status. Omit for all. */
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
