import { IsEnum, IsIn, IsOptional, IsUUID } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { PaymentSource, PaymentStatus } from "../payment.entity.js";

/** Query string of `GET /payments`, e.g. `?match=review&source=email_zelle&page=1&limit=20`. */
export class ListPaymentsQueryDto extends PaginationQueryDto {
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
