import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, Matches } from "class-validator";
import { trimOrNull } from "./driver-profile.dto.js";

/**
 * Decorators for a "time rent is due" field: `HH:MM` on a 24-hour clock (`18:00` = 6 PM), Chicago time. Empty or `null`
 * clears it (not set). Shared by "Add driver" and "Edit rent settings", like a Mongoose validator reused in two schemas.
 */
export function IsRentDueTime(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Transform(trimOrNull),
    Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
      message:
        "rentDueTime must be a time written HH:MM (24 hours), e.g. 18:00",
    }),
  );
}

/**
 * Body of `PATCH /drivers/:id/rent-settings` (D92). A field left out stays as it is; `rentDueTime` sent empty or `null`
 * is cleared.
 */
export class UpdateDriverRentSettingsDto {
  /** The time of day rent is due, Chicago time, `HH:MM`; `null` = not set. */
  @IsRentDueTime()
  rentDueTime?: string | null;

  /** Staff marked the driver "On Payment Plan": left out of the Should Be Deactivated list while true. */
  @IsOptional()
  @IsBoolean()
  onPaymentPlan?: boolean;
}
