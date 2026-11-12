import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { OTHER_SLOT_COUNT } from "../application-document.entity.js";

/** The extra query fields of a driver document upload: only an "Other" document uses them. */
export class UploadDocumentQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: OTHER_SLOT_COUNT,
    description:
      'Which "Other" slot (1 to 5). Required for kind `other`, ignored otherwise.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OTHER_SLOT_COUNT)
  slot?: number;

  @ApiPropertyOptional({
    maxLength: 60,
    description:
      'What the document is, for example "Insurance card". Required for kind `other`, ignored otherwise.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}
