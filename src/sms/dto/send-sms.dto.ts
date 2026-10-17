import { IsString, MaxLength, MinLength } from "class-validator";

/** Body of `POST /sms/:kind/:id/messages`. */
export class SendSmsDto {
  /** The words to send, 1 to 1600 characters (Quo's limit). Plain text only: Quo's API cannot send files. */
  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  text: string;
}
