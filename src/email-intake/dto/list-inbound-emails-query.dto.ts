import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsIn, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto.js";
import {
  InboundEmailStatus,
  PROVIDER_VALUES,
  type InboundEmailProvider,
} from "../inbound-email.entity.js";

/** Query string of `GET /inbound-emails`, e.g. `?status=extraction_failed&provider=venmo`. */
export class ListInboundEmailsQueryDto extends PaginationQueryDto {
  /** Only emails with this outcome. Omit for all. */
  @IsOptional()
  @IsEnum(InboundEmailStatus)
  status?: InboundEmailStatus;

  /** Only emails from this provider. Omit for all. */
  @ApiPropertyOptional({
    enum: PROVIDER_VALUES,
    enumName: "InboundEmailProvider",
  })
  @IsOptional()
  @IsIn(PROVIDER_VALUES)
  provider?: InboundEmailProvider;
}
