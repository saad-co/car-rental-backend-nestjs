import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/** Query string of `GET /sms/:kind/:id/messages`. */
export class ListSmsQueryDto {
  /** Texts per page (1 to 100), newest first. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;

  /** The `nextCursor` of the previous page, to get the texts before it. Omit for the newest. */
  @IsOptional()
  @IsString()
  before?: string;
}
