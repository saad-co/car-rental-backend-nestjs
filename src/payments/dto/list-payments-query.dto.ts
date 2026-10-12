import { IsEnum, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import { PaymentSource, PaymentStatus } from "../payment.entity.js";

/** Query string of `GET /payments`, e.g. `?status=unmatched&source=email_zelle&page=1&limit=20`. */
export class ListPaymentsQueryDto extends PaginationQueryDto {
  /** Only payments with this status. Omit for all. */
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /** Only payments from this source. Omit for all. */
  @IsOptional()
  @IsEnum(PaymentSource)
  source?: PaymentSource;
}
