import { Transform } from "class-transformer";
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { trimOrNull } from "./driver-profile.dto.js";

/**
 * Body of `PATCH /drivers/:id/contact` (B148, D117): the driver's email and phone. A field left out stays as it is; neither
 * can be cleared (the driver table needs both), so an empty one is a `400`.
 *
 * `ValidateIf(value !== undefined)` is the "optional" switch: a field that is not in the body is skipped, one that is
 * sent (even empty or `null`) is checked. (`IsOptional` would also skip `null`, which would let a clear through.)
 */
export class UpdateDriverContactDto {
  /** Stored lower-case. */
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(254)
  email?: string;

  /** A US number in any common writing; stored as `+1` and 10 digits. */
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty({ message: "phone cannot be empty" })
  @MaxLength(30)
  phone?: string;
}
