import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { AliasType } from "../../aliases/normalize-alias.js";

/**
 * Body of `POST /drivers/:id/aliases` (D69): one name or handle this driver pays from, under one payment method.
 * Phone and email values get an extra format check in the service (they depend on the type).
 */
export class AddAliasDto {
  /** The payment method the name or handle belongs to; matching only compares aliases of the payment's own method. */
  @IsEnum(AliasType)
  type: AliasType;

  /** The name, handle, company, email or phone as the payer shows it. Extra spaces are trimmed. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value,
  )
  @IsString()
  @IsNotEmpty({ message: "Enter a name or handle." })
  @MaxLength(255)
  value: string;
}
