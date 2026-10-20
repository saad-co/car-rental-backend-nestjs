import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { MAX_MANUAL_ENTRY_CENTS } from "../../ledger/dto/ledger-entry.dto.js";
import {
  LedgerPresetKind,
  MAX_PRESET_DESCRIPTION_LENGTH,
  MAX_PRESET_NAME_LENGTH,
} from "../ledger-preset.entity.js";

/** Trims a string before the checks run; anything else is left for `@IsString` to refuse. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** One preset as the Settings page and the "New ledger entry" window show it. */
export class LedgerPresetDto {
  id: string;
  @ApiProperty({ enum: LedgerPresetKind, enumName: "LedgerPresetKind" })
  kind: LedgerPresetKind;
  /** The card's title, e.g. "Late fee". */
  name: string;
  /** The default amount in whole cents, or null for "enter amount". */
  amountCents: number | null;
  /** What the Description box is filled with. */
  description: string;
  /** The order of the cards within a kind, from 1. */
  position: number;
  updatedAt: Date;
}

/** Body of `PUT /ledger-presets/:id`: a preset's name, amount and description (the kind never changes). */
export class UpdateLedgerPresetDto {
  /** 1 to 60 characters after trimming. Two presets of a kind cannot share a name (409). */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "The name is empty." })
  @MaxLength(MAX_PRESET_NAME_LENGTH)
  name: string;

  /** Whole cents, 1 to 1,000,000 ($10,000), or left out / null for "enter amount". */
  @IsOptional()
  @IsInt({ message: "The amount must be a whole number of cents." })
  @Min(1, { message: "The amount must be more than $0." })
  @Max(MAX_MANUAL_ENTRY_CENTS, {
    message: "The amount can be at most $10,000.",
  })
  amountCents?: number | null;

  /** What the Description box is filled with: 1 to 500 characters after trimming. */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "The description is empty." })
  @MaxLength(MAX_PRESET_DESCRIPTION_LENGTH)
  description: string;
}

/** Body of `POST /ledger-presets`. */
export class CreateLedgerPresetDto extends UpdateLedgerPresetDto {
  @ApiProperty({ enum: LedgerPresetKind, enumName: "LedgerPresetKind" })
  @IsEnum(LedgerPresetKind)
  kind: LedgerPresetKind;
}

/** Body of `PUT /ledger-presets/order`: every preset id of one kind, in the order the cards should show. */
export class ReorderLedgerPresetsDto {
  @ApiProperty({ enum: LedgerPresetKind, enumName: "LedgerPresetKind" })
  @IsEnum(LedgerPresetKind)
  kind: LedgerPresetKind;

  /** Exactly the ids of that kind's presets, each once (400 otherwise). */
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids: string[];
}
