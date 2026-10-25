import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsOptional } from "class-validator";
import {
  ArchivedQueryDto,
  queryBoolean,
} from "../../common/dto/archived-query.dto.js";
import { DriverStatus } from "../driver.entity.js";

/**
 * Query string of `GET /drivers`, e.g. `?status=active&search=pat&page=1&limit=8&onboarding=false`.
 * `search` matches the name (first, last or both), email, and the phone by its digits.
 * `archived=true` shows only archived drivers; otherwise they are hidden (D80).
 */
export class ListDriversQueryDto extends ArchivedQueryDto {
  /** Only drivers with this status. Omit for all. */
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;

  /**
   * `false` leaves out drivers still in `onboarding`: the Drivers page lists only active and inactive drivers, those
   * in onboarding are on the Approved applications page (D80). Omitted or `true`: every status, which is what the
   * payment pickers need (a deposit arrives while the driver is still in onboarding).
   */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  onboarding?: boolean;

  /**
   * `true` lists only drivers in collections (D81), newest sent first, and the date range then filters the day they
   * were sent. `false` leaves them out: the Drivers page, since they are on the Collections page. Omitted: no
   * collections filter, which is what the payment pickers need (money from a driver in collections must still be
   * assignable to them).
   */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  collections?: boolean;
}
