import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { trimOrNull } from "../../drivers/dto/driver-profile.dto.js";
import { LedgerEntryDto } from "../../ledger/dto/ledger-entry.dto.js";
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
  /** When staff marked it reviewed; null until then. */
  reviewedAt: Date | null;
  /**
   * True when staff should look at it: flagged for new damage, or submitted more than 24 hours ago and still not reviewed
   * (spec p. 11). Worked out on read.
   */
  needsAttention: boolean;
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

/**
 * One photo of an inspection as staff see it. The three links are signed for ten minutes and stop working after that: the page
 * asks again when it reloads. Nothing in the bucket is public.
 */
export class InspectionPhotoDto {
  id: string;
  /** A shot id from the 19-shot list, or `DAMAGE` for a close-up added by the driver. */
  shotId: string;
  /** 1 for a shot; 1 to 15 for damage. */
  position: number;
  /** The driver's note under the photo. */
  driverNote: string | null;
  /** The time on the phone when it was taken (a device value: informative only). */
  capturedAt: Date | null;
  /** The server's time when the file arrived: the one to trust. */
  uploadedAt: Date;
  /** How many times the driver replaced this photo. */
  retakeCount: number;
  /** The server's SHA-256 fingerprint of the file, for disputes. */
  sha256: string;
  /** The 400 px thumbnail; null when the bucket is not set up. */
  thumbUrl: string | null;
  /** The full photo, to show full screen. */
  fullUrl: string | null;
  /** The full photo as a download (the browser saves it as `<reference>_<NN>_<SHOT>.jpg`). */
  downloadUrl: string | null;
}

/** Body of `POST /inspections/:id/review`. */
export class ReviewInspectionDto {
  /** An optional note kept with the review, up to 500 characters. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** Body of `POST /inspections/:id/notes`. */
export class AddInspectionNoteDto {
  /** A staff note, 1 to 500 characters after trimming. It joins the activity log. */
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty({ message: "The note is empty." })
  @MaxLength(500)
  text: string;
}

/** The latest check-in and check-out of a driver (not counting revoked ones); null when there is none. */
export class LatestInspectionsDto {
  checkIn: InspectionDto | null;
  checkOut: InspectionDto | null;
}

/** One inspection with its activity log and its photos. */
export class InspectionDetailDto extends InspectionDto {
  /** The admin who reviewed it; null until reviewed. */
  reviewedByEmail: string | null;
  /** The note kept with the review, if any. */
  reviewNote: string | null;
  events: InspectionEventDto[];
  /** Where the phone was when the driver submitted, if it had already allowed location. */
  gpsLat: number | null;
  gpsLng: number | null;
  /** The browser and phone, as the browser reported them. */
  deviceInfo: string | null;
  /** When the driver ticked the box that the photos show the car's condition right now. */
  attestedAt: Date | null;
  /** The 19 shots in order, then the damage close-ups in the order taken. */
  photos: InspectionPhotoDto[];
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

// ------------------------------------------------------------- compare (step 3)

/** Body of `POST /inspections/:id/damage-items`: "New damage" on one check-out photo. */
export class CreateDamageItemDto {
  /** The check-out photo that shows the damage (one of its 19 shots or one of its damage close-ups). */
  @IsUUID()
  photoId: string;

  /** What the damage is, 1 to 500 characters after trimming. */
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty({ message: "Describe the damage." })
  @MaxLength(500)
  description: string;
}

/** Damage staff found on a check-out that was not on the check-in. */
export class DamageItemDto {
  id: string;
  /** The check-out it was found on. */
  inspectionId: string;
  /** The check-out photo that shows it. */
  photoId: string;
  /** Where on the car: a shot id, or `DAMAGE` for a close-up the driver added. */
  shotId: string;
  /** `driver_reported` = the driver added the close-up; `staff_flagged` = staff found it on one of the 19 shots. */
  source: "driver_reported" | "staff_flagged";
  description: string;
  status: "new_during_rental" | "charged";
  /** The ledger charge made for it (set when `status` is `charged`). */
  ledgerEntryId: string | null;
  ledgerRef: string | null;
  amountCents: number | null;
  createdByEmail: string | null;
  createdAt: Date;
}

/** One of the 19 shots: the check-in photo beside the check-out photo, and what staff decided. */
export class ComparePairDto {
  shotId: string;
  checkIn: InspectionPhotoDto | null;
  checkOut: InspectionPhotoDto | null;
  /** Null = "No change". */
  damageItem: DamageItemDto | null;
}

/** A damage close-up of the check-out and whether staff marked it as new damage. */
export class CompareDamagePhotoDto {
  photo: InspectionPhotoDto;
  damageItem: DamageItemDto | null;
}

/**
 * A check-out set beside its check-in (`GET /inspections/:id/compare`). `available` is false (with `reason`) when the page has
 * nothing to compare: it is not a check-out, it is not paired with a check-in, or one of the two has not been submitted.
 */
export class InspectionCompareDto {
  available: boolean;
  reason: string | null;
  checkOut: InspectionDto;
  checkIn: InspectionDto | null;
  /** Check-out odometer minus check-in odometer. */
  milesDriven: number | null;
  /** Check-out fuel minus check-in fuel, in eighths of a tank. */
  fuelChangeEighths: number | null;
  pairs: ComparePairDto[];
  /** Damage the driver photographed at pickup: already there, read-only and never chargeable. */
  checkInDamage: InspectionPhotoDto[];
  /** Damage close-ups the driver added at return, each markable as new damage. */
  checkOutDamage: CompareDamagePhotoDto[];
}

/** The answer of `POST /damage-items/:id/charge`: the damage item (now charged) and the ledger entry it made. */
export class ChargeDamageItemResultDto {
  item: DamageItemDto;
  entry: LedgerEntryDto;
}
