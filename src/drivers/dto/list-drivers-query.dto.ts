import { IsEnum, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { DriverStatus } from "../driver.entity.js";

/** Query string of `GET /drivers`, e.g. `?status=active&page=1&limit=20`. */
export class ListDriversQueryDto extends PaginationQueryDto {
  /** Only drivers with this status. Omit for all. */
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}
