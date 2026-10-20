import { Transform } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import {
  COUNTS,
  DURATIONS,
  PLATFORMS,
  YEARS_DRIVING,
  YES_NO,
} from "./website-form.js";

/** Trims a text value; an empty one becomes `undefined`, so "" counts as "not filled in" for optional fields. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text === "" ? undefined : text;
};

/** The phone as 10 digits: punctuation dropped, and a leading US country code 1 removed. */
const tenDigits = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
};

/** One platform sent as a single value arrives as a string; several arrive as an array. Make both an array. */
const asArray = ({ value }: { value: unknown }): unknown =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * The text fields of `POST /applications/manual` (D68), sent as multipart form data next to the files. Multipart
 * puts every value in as text, so numbers stay strings, as on the website. The rules are the gonzocar.com form's
 * (its required fields, its choices, age 25 or older), so a hand-typed application is as complete as a website one.
 * Field names are the website's (snake_case), so the stored payload has the same keys.
 */
export class ManualApplicationDto {
  /** Made once by the form; the same id sent twice (a double click) makes one application. */
  @IsUUID()
  request_id: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "first_name is required" })
  @MaxLength(100)
  first_name: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "last_name is required" })
  @MaxLength(100)
  last_name: string;

  /** Stored lower-case. */
  @Transform((params) => {
    const value = trimmed(params);
    return typeof value === "string" ? value.toLowerCase() : value;
  })
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(254)
  email: string;

  /** 10 digits, no punctuation. */
  @Transform(tenDigits)
  @Matches(/^\d{10}$/, { message: "phone must be 10 digits" })
  phone: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "street is required" })
  @MaxLength(200)
  street: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  apt?: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "city is required" })
  @MaxLength(100)
  city: string;

  @Transform(trimmed)
  @Matches(/^\d{5}$/, { message: "zip must be 5 digits" })
  zip: string;

  @Transform(trimmed)
  @Matches(/^(2[5-9]|[3-9]\d)$/, { message: "age must be 25 or older" })
  age: string;

  @Transform(trimmed)
  @IsIn(YEARS_DRIVING)
  years_driving: string;

  @Transform(trimmed)
  @IsIn(COUNTS, { message: "violations must be 0, 1, 2 or 3+" })
  violations: string;

  @Transform(trimmed)
  @IsIn(COUNTS, { message: "accidents must be 0, 1, 2 or 3+" })
  accidents: string;

  /** At least one. */
  @Transform(asArray)
  @IsArray()
  @ArrayMinSize(1, { message: "platforms must have at least one app" })
  @IsIn(PLATFORMS, { each: true })
  platforms: string[];

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  driver_rating?: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  earnings?: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  previous_companies?: string;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referred_by?: string;

  /** `YYYY-MM-DD`, a real calendar day. */
  @Transform(trimmed)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "start_date must be YYYY-MM-DD" })
  @IsISO8601({ strict: true }, { message: "start_date must be a real date" })
  start_date: string;

  @Transform(trimmed)
  @IsIn(DURATIONS)
  duration: string;

  @Transform(trimmed)
  @IsIn(YES_NO)
  has_startup_funds: string;

  /**
   * What the applicant has to get started, in USD. The website asks only when the first week and deposit are NOT
   * covered, and then requires it; with "yes" it is not asked (and dropped if sent).
   */
  @Transform(trimmed)
  @ValidateIf((form: ManualApplicationDto) => form.has_startup_funds === "no")
  @Matches(/^\d{1,7}(\.\d{1,2})?$/, {
    message: "capital must be an amount in USD, like 400 or 400.50",
  })
  capital?: string;

  @Transform(trimmed)
  @IsIn(YES_NO)
  has_insurance: string;

  @Transform(trimmed)
  @IsIn(YES_NO)
  has_insurance_last_45_days: string;
}
