import { IsBoolean, IsOptional } from "class-validator";

/** Optional body of `POST /applications/:id/reject` (B72). An empty body declines without a text. */
export class DeclineApplicationDto {
  /** `true` also texts the applicant the "declined" template from Settings. Default false. */
  @IsOptional()
  @IsBoolean()
  sendText?: boolean;
}
