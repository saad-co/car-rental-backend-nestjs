import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { DriverLanguage } from "../../drivers/driver.entity.js";
import { trimOrNull } from "../../drivers/dto/driver-profile.dto.js";
import { FuelLevel, InspectionType } from "../inspection.entity.js";
import {
  MAX_CLOSE_UPS_PER_SHOT,
  MAX_PHOTO_NOTE_LENGTH,
} from "../inspection-photo.entity.js";

/** Empty text from a form field counts as "not sent". */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * A number from a form field, which arrives as text: empty = not sent, anything else is converted (so "84k" becomes NaN and fails
 * the integer check). Done in one step because `@Type(() => Number)` would turn an empty text into 0 before any other rule runs.
 */
const textToNumber = ({ value }: { value: unknown }) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "")
    ? undefined
    : Number(value);

/**
 * The text fields of `PUT /i/:token/photos/:shotId` (sent as multipart form data next to the file `photo`, so every value arrives
 * as text). Everything is optional: the page may send the photo first and the note or the reading a moment later.
 */
export class UploadPhotoDto {
  /** Which close-up of the shot, 1 to 5. Only for the shot `DAMAGE`; a required shot has just one photo. */
  @IsOptional()
  @Transform(textToNumber)
  @IsInt()
  @Min(1)
  @Max(MAX_CLOSE_UPS_PER_SHOT)
  position?: number;

  /** For a damage close-up (`DAMAGE`): the required shot it belongs to, e.g. `EXT_LEFT_MIRROR` (D112). Required with `DAMAGE`. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(40)
  parentShotId?: string;

  /** The optional "+ Damage note", or the note under a damage close-up. Sent empty, it is cleared. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(MAX_PHOTO_NOTE_LENGTH)
  note?: string | null;

  /** When the phone took the photo (ISO 8601). A device value: the server stamps its own time too. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsISO8601()
  capturedAt?: string;

  /** The mileage typed from the odometer photo, whole miles. Only with the shot `INT_ODOMETER`. Not sent by the page since D112. */
  @IsOptional()
  @Transform(textToNumber)
  @IsInt({ message: "odometerMiles must be a whole number" })
  @Min(0)
  @Max(2_000_000)
  odometerMiles?: number;

  /** The fuel level chosen on the fuel bar. Only with the shot `INT_FUEL`. Not sent by the page since D112. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(FuelLevel)
  fuelLevel?: FuelLevel;
}

/** Body of `POST /i/:token/submit`. */
export class SubmitInspectionDto {
  /** The one checkbox: "These photos show the car's condition right now." Must be `true`. */
  @Equals(true, { message: "The box must be checked to submit." })
  attested: boolean;

  /** Where the phone was, if it already allowed location (never asked for); both or neither. */
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  gpsLng?: number;

  /** The browser and phone, as the browser reports them, for disputes. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(500)
  deviceInfo?: string | null;
}

/** Body of `PUT /i/:token/shots/:shotId/damage-answer`: the driver's answer to "Is there any damage on the <shot>?" (D112). */
export class DamageAnswerDto {
  @IsBoolean({ message: "hasDamage must be true or false" })
  hasDamage: boolean;
}

/** One answer already given, so a reopened link resumes where it was. */
export class ShotAnswerDto {
  shotId: string;
  hasDamage: boolean;
}

/** Body of `POST /i/:token/language`. */
export class SetLanguageDto {
  @IsIn(Object.values(DriverLanguage), {
    message: "language must be en or es",
  })
  language: DriverLanguage;
}

/** The vehicle as the driver confirms it: the model as typed, the plate and the last four characters of the VIN. */
export class CaptureVehicleDto {
  model: string;
  plate: string | null;
  vinLast4: string | null;
}

/** One required shot of the walk-around, in order. The words come from the translation file on the page. */
export class CaptureShotDto {
  shotId: string;
  position: number;
  required: boolean;
}

/** A photo already received, so a reopened link can resume and show its thumbnail strip. */
export class CapturePhotoDto {
  /** A shot id, or `DAMAGE`. */
  shotId: string;
  /** 1 for a required shot; 1 to 5 for a close-up (1 to 15 for an old free-standing damage photo). */
  position: number;
  /** For a close-up: the required shot it belongs to. */
  parentShotId: string | null;
  note: string | null;
  /** A short-lived link to the 400 px thumbnail; null when the bucket is not set up. */
  thumbUrl: string | null;
}

/**
 * Damage recorded at check-in, shown at a check-out next to the same shot's damage question, so the driver does not report it
 * again. `parentShotId` is the shot (null for an old free-standing damage photo).
 */
export class PriorDamageDto {
  parentShotId: string | null;
  note: string | null;
  thumbUrl: string | null;
}

export type CaptureLinkState = "open" | "submitted" | "expired" | "revoked";

/**
 * What the capture page needs, in one answer. `state` says what to show: `open` (the page proper), `submitted` ("Already submitted"
 * with the reference), `revoked` ("no longer active") or `expired` ("This link has expired"). An unknown token answers `expired`,
 * the same as a real one that ran out, so nobody can tell which tokens exist. Fields other than `state` are filled only when they
 * apply.
 */
export class CaptureStateDto {
  @ApiProperty({ enum: ["open", "submitted", "expired", "revoked"] })
  state: CaptureLinkState;
  reference: string | null;
  type: InspectionType | null;
  /** The language the driver saved (English until chosen). */
  language: DriverLanguage | null;
  vehicle: CaptureVehicleDto | null;
  /** Every shot, in order; `required` ones must all have a photo before the page can submit. */
  shots: CaptureShotDto[];
  /** The photos received so far, close-ups included. */
  photos: CapturePhotoDto[];
  /** The damage answers given so far, one per shot answered. */
  answers: ShotAnswerDto[];
  odometerMiles: number | null;
  fuelLevel: FuelLevel | null;
  /** The damage photos of the paired check-in, for a check-out. Empty otherwise. */
  priorDamage: PriorDamageDto[];
  /** The most close-ups one shot can hold (5). */
  maxCloseUpsPerShot: number;
  /** When the link stops working (open only). */
  expiresAt: Date | null;
  /** When it was submitted (submitted only). */
  submittedAt: Date | null;
  /** A number for the "Call GonzoCar" button, E.164; null until `INSPECTION_SUPPORT_PHONE` is set (the button is then hidden). */
  supportPhone: string | null;
}

/** The answer to an upload: the slot it landed in and what the server recorded. */
export class UploadedPhotoDto {
  shotId: string;
  position: number;
  parentShotId: string | null;
  /** True when this call stored a new file (a first photo or a retake); false when only the note or reading was updated. */
  stored: boolean;
  /** How many times the driver replaced this photo. */
  retakeCount: number;
  /** The server's SHA-256 fingerprint of the file. */
  sha256: string;
  thumbUrl: string | null;
}

/** The answer to a submit. */
export class SubmittedInspectionDto {
  reference: string;
  submittedAt: Date;
}
