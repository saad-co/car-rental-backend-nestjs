import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

/** Trims a text value; an empty one becomes `null` (nothing known), so clearing a field is sending it empty. */
export const trimOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text === "" ? null : text;
};

/** Yes / no as a boolean. A form sends text (`true`, `false`, `yes`, `no`); empty means not known. */
const yesNoOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const text = value.trim().toLowerCase();
  if (text === "true" || text === "yes") return true;
  if (text === "false" || text === "no") return false;
  return text === "" ? null : value;
};

/**
 * The profile fields (D85), all optional and checked only for length and, for the date of birth, for being a real
 * calendar day. Shared by "Add driver" and "Edit profile". Sending a field empty (or `null`) clears it; leaving it out
 * leaves it as it is (on an edit).
 */
export class DriverProfileFieldsDto {
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  middleName?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  street?: string | null;

  /** Apartment or unit. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(50)
  apt?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  /** As typed ("IL" or "Illinois"). */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(50)
  state?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(10)
  zip?: string | null;

  /** `YYYY-MM-DD`, a real day that is not in the future. The age is worked out from it. */
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "dateOfBirth must be a day written YYYY-MM-DD",
  })
  @IsISO8601({ strict: true }, { message: "dateOfBirth must be a real day" })
  dateOfBirth?: string | null;

  /** Current auto insurance: `true` / `false`; empty = not known. */
  @IsOptional()
  @Transform(yesNoOrNull)
  @IsBoolean()
  hasInsurance?: boolean | null;
}

/** Body of `PATCH /drivers/:id/profile` (D85): the profile fields; the ones left out stay as they are. */
export class UpdateDriverProfileDto extends DriverProfileFieldsDto {}
