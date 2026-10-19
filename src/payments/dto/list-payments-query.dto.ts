import { IsEnum, IsIn, IsOptional, IsUUID } from "class-validator";
import { DateRangeQueryDto } from "../../common/dto/date-range-query.dto.js";
import { PaymentSource, PaymentStatus } from "../payment.entity.js";

/**
 * Query string of `GET /payments`, e.g. `?match=review&source=email_zelle&search=sutton&page=1&limit=8`.
 * `search` matches the payer's name and handle, and the assigned driver's name.
 */
export class ListPaymentsQueryDto extends DateRangeQueryDto {
  /** Only payments with this status. Omit for all. */
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /** Only payments from this source. Omit for all. */
  @IsOptional()
  @IsEnum(PaymentSource)
  source?: PaymentSource;

  /** Only payments assigned to this driver (the driver page). Omit for all. */
  @IsOptional()
  @IsUUID()
  driverId?: string;

  /**
   * `assigned`: has a driver. `review`: matching looked at it and could not place it ("Needs review").
   * Omit for all.
   */
  @IsOptional()
  @IsIn(["assigned", "review"])
  match?: "assigned" | "review";
}
