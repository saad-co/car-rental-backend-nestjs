import { IsEnum, IsOptional } from "class-validator";
import { SearchQueryDto } from "../../common/dto/search-query.dto.js";
import { DriverStatus } from "../driver.entity.js";

/**
 * Query string of `GET /drivers`, e.g. `?status=active&search=pat&page=1&limit=8`.
 * `search` matches the name (first, last or both), email, and the phone by its digits.
 */
export class ListDriversQueryDto extends SearchQueryDto {
  /** Only drivers with this status. Omit for all. */
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}
