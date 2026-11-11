import { plainToInstance, Transform } from "class-transformer";
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { AddAliasDto } from "./add-alias.dto.js";
import { DriverProfileFieldsDto, trimOrNull } from "./driver-profile.dto.js";
import { IsRentDueTime } from "./rent-settings.dto.js";

/**
 * Body of `POST /drivers` (D85): an admin adds a driver directly, without an application. Sent as multipart form data
 * next to the files `licenseFile` and `earningsFile` (JPG, PNG or PDF, at most 10 MB each, both optional), so every
 * value arrives as text.
 *
 * Only the name, email and phone are required: the driver table needs them (matching, the chat, one driver per email
 * and phone). Everything else may be left empty and filled in later.
 */
export class CreateDriverDto extends DriverProfileFieldsDto {
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty({ message: "firstName is required" })
  @MaxLength(100)
  firstName: string;

  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty({ message: "lastName is required" })
  @MaxLength(100)
  lastName: string;

  /** Stored lower-case. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(254)
  email: string;

  /** A US number in any common writing; stored as `+1` and 10 digits. */
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty({ message: "phone is required" })
  @MaxLength(30)
  phone: string;

  /** The time of day rent is due, Chicago time `HH:MM` (D92); optional, can be set later on the driver page. */
  @IsRentDueTime()
  rentDueTime?: string | null;

  /**
   * The payment methods and handles the driver pays from (payment method + ID / alias), as a JSON text because the body is
   * multipart: `[{"type":"zelle","value":"Pat Example"}]`. Each one is saved as a payment alias with the same rules as
   * adding one on the driver page (D69).
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value) as unknown;
      // Turned into real AddAliasDto objects here (class-transformer's @Type runs before this parse, on the text), so
      // each one gets its own trimming and checks.
      return Array.isArray(parsed)
        ? plainToInstance(AddAliasDto, parsed as unknown[])
        : parsed;
    } catch {
      return value; // not JSON: the array check below answers with a message
    }
  })
  @IsArray({ message: "aliases must be a JSON list" })
  @ValidateNested({ each: true })
  aliases?: AddAliasDto[];
}
