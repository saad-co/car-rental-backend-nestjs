import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { queryBoolean } from "../../common/dto/archived-query.dto.js";

/** Query string of `POST /applications/manual`, e.g. `?startOnboarding=true` (D80). */
export class ManualApplicationQueryDto {
  /**
   * `true` for "Add driver": after approving, also create the driver (in onboarding), so the admin lands on the
   * driver's page. Omitted or `false` for "Add application": approved only, no driver.
   */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  startOnboarding?: boolean;
}
