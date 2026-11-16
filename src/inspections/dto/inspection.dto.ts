import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { trimOrNull } from "../../drivers/dto/driver-profile.dto.js";
import { SmsMode, SmsStatus } from "../../sms/sms-message.entity.js";
import {
  FuelLevel,
  InspectionStatus,
  InspectionType,
} from "../inspection.entity.js";
import type { EffectiveInspectionStatus } from "../inspection-status.js";

/** The vehicle typed by an admin for a driver who has no signed contract with a vehicle (our suggestion, D102). */
export class InspectionVehicleInputDto {
  /** Make and model as you would say it (the contract keeps one typed text too), e.g. `2021 Toyota Camry`. */
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty({ message: "model is required" })
  @MaxLength(200)
  model: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(50)
  vin?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(20)
  plate?: string | null;
}

/** Body of `POST /drivers/:id/inspections`. */
export class CreateInspectionDto {
  @IsEnum(InspectionType)
  type: InspectionType;

  /** Only for a driver with no signed contract that holds a vehicle; otherwise the vehicle is copied from the contract. */
  @IsOptional()
  @ValidateNested()
  @Type(() => InspectionVehicleInputDto)
  vehicle?: InspectionVehicleInputDto;
}

/** The vehicle of an inspection as shown. */
export class InspectionVehicleDto {
  model: string;
  vin: string | null;
  plate: string | null;
}

/** One inspection as the driver page lists it. The link is never in it: only the answers that make a link carry one. */
export class InspectionDto {
  id: string;
  /** `INS-2026-000123`. */
  reference: string;
  type: InspectionType;
  /**
   * Where it is. `created` = no link handed out yet; `expired` is worked out from the link time, never stored (D102).
   */
  @ApiProperty({ enum: [...Object.values(InspectionStatus), "expired"] })
  status: EffectiveInspectionStatus;
  driverId: string;
  /** The signed contract the vehicle was copied from; null when the vehicle was typed. */
  contractId: string | null;
  vehicle: InspectionVehicleDto;
  /** On a check-out, the check-in it will be compared with. */
  pairedInspectionId: string | null;
  /** When the current link stops working. Meaningless while `status` is `created`. */
  tokenExpiresAt: Date;
  linkSentAt: Date | null;
  openedAt: Date | null;
  startedAt: Date | null;
  submittedAt: Date | null;
  odometerMiles: number | null;
  fuelLevel: FuelLevel | null;
  /** Photos of the required shots received so far. */
  photoCount: number;
  /** Damage close-ups received so far. */
  damagePhotoCount: number;
  createdAt: Date;
}

/** A line of an inspection's activity log. */
export class InspectionEventDto {
  id: string;
  type: string;
  /** The admin who did it; null = the driver or the system. */
  actorEmail: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

/** One inspection with its activity log. */
export class InspectionDetailDto extends InspectionDto {
  events: InspectionEventDto[];
}

/** One page of a driver's inspections, newest first. */
export class InspectionListDto {
  items: InspectionDto[];
  total: number;
  page: number;
  limit: number;
  /**
   * The vehicle of the driver's latest signed contract, or null when there is none (then the page asks for the vehicle
   * when it creates an inspection).
   */
  contractVehicle: InspectionVehicleDto | null;
}

/** The answer of `reissue`: the inspection and the one and only copy of its new link. */
export class InspectionLinkDto {
  inspection: InspectionDto;
  /** The full link, `<site>/i/<token>`. It cannot be shown again: only its hash is stored (D102). */
  link: string;
}

/** The answer of `send`: the link, and what happened to the text that carries it. */
export class SendInspectionLinkDto extends InspectionLinkDto {
  /** `dry_run`: the text was only saved in the chat, not sent. `live`: sent through Quo. */
  textMode: SmsMode;
  textStatus: SmsStatus;
}
