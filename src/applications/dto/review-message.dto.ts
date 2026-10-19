import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { MAX_TEMPLATE_LENGTH } from "../../message-templates/message-template.entity.js";

/**
 * Optional body of `POST /applications/:id/approve` and `POST /applications/:id/reject` (B72, B81): the text to send
 * the applicant, as the admin picked it from a template and perhaps edited it in the dialog.
 */
export class ReviewMessageDto {
  /**
   * The text, with `{firstName}` / `{lastName}` placeholders (filled in by the API; unknown ones are refused, 400).
   * 1 to 1000 characters after trimming. Approve without it sends the first approved template; decline without it
   * sends no text.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: "The text is empty." })
  @MaxLength(MAX_TEMPLATE_LENGTH)
  message?: string;
}
