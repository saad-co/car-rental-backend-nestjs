import { Module } from "@nestjs/common";
import { MailService } from "./mail.service.js";

/** Email sending. Import this module wherever MailService is needed. */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
