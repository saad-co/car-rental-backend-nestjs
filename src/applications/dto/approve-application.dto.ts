import { IsBoolean, IsOptional } from "class-validator";
import { ReviewMessageDto } from "./review-message.dto.js";

/**
 * Optional body of `POST /applications/:id/approve`: the approval text (as in `ReviewMessageDto`), or no text at all
 * with `sendText: false` (B111).
 */
export class ApproveApplicationDto extends ReviewMessageDto {
  /** `false` approves without texting the applicant (`message` is then ignored). Default `true`. */
  @IsOptional()
  @IsBoolean()
  sendText?: boolean;
}
