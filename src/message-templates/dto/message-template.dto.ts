import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";
import {
  MAX_TEMPLATE_LENGTH,
  TemplateKey,
} from "../message-template.entity.js";

/** One template as the Settings page shows it. */
export class MessageTemplateDto {
  key: TemplateKey;
  /** The text with its placeholders, e.g. `Hi {firstName}, ...`. */
  body: string;
  /** The placeholders this template may use, e.g. `["firstName", "lastName"]`. */
  placeholders: string[];
  updatedAt: Date;
  /** Email of the admin who last edited it; null for the default text (or a removed account). */
  updatedByEmail: string | null;
}

/** Body of `PUT /message-templates/:key`. */
export class UpdateMessageTemplateDto {
  /** The new text, 1 to 1000 characters after trimming; line breaks kept. Unknown placeholders are refused (400). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: "The text is empty." })
  @MaxLength(MAX_TEMPLATE_LENGTH)
  body: string;
}
