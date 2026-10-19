import { Transform } from "class-transformer";
import { IsEnum, IsString, MaxLength, MinLength } from "class-validator";
import {
  MAX_TEMPLATE_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  TemplateKind,
} from "../message-template.entity.js";

/** Trims a string before the checks run; anything else is left for `@IsString` to refuse. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** One template as the Settings page and the Approve / Decline dialogs show it. */
export class MessageTemplateDto {
  id: string;
  kind: TemplateKind;
  /** The label in the dropdown, e.g. "No valid licence". */
  name: string;
  /** The text with its placeholders, e.g. `Hi {firstName}, ...`. */
  body: string;
  /** The placeholders this template may use, e.g. `["firstName", "lastName"]`. */
  placeholders: string[];
  updatedAt: Date;
  /** Email of the admin who last edited it; null for the default text (or a removed account). */
  updatedByEmail: string | null;
}

/** Body of `PUT /message-templates/:id`: a template's name and text (the kind never changes). */
export class UpdateMessageTemplateDto {
  /** 1 to 60 characters after trimming. Two templates of a kind cannot share a name (409). */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "The name is empty." })
  @MaxLength(MAX_TEMPLATE_NAME_LENGTH)
  name: string;

  /** The new text, 1 to 1000 characters after trimming; line breaks kept. Unknown placeholders are refused (400). */
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "The text is empty." })
  @MaxLength(MAX_TEMPLATE_LENGTH)
  body: string;
}

/** Body of `POST /message-templates`. */
export class CreateMessageTemplateDto extends UpdateMessageTemplateDto {
  @IsEnum(TemplateKind)
  kind: TemplateKind;
}
