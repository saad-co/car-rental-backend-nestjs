import { IsEnum, IsOptional } from "class-validator";
import { DriverLeftReason } from "../driver.entity.js";

/** Body of `POST /drivers/:id/deactivate`: how the driver left. Always required (D81). */
export class DeactivateDriverDto {
  @IsEnum(DriverLeftReason)
  reason: DriverLeftReason;
}

/**
 * Body of `POST /drivers/:id/collections`. `reason` is needed when the driver has no reason noted yet (still active,
 * or deactivated before reasons existed); a driver who already has one keeps it and the field may be left out.
 */
export class SendToCollectionsDto {
  @IsOptional()
  @IsEnum(DriverLeftReason)
  reason?: DriverLeftReason;
}
