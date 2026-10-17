import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MessageTemplate } from "./message-template.entity.js";
import { MessageTemplatesController } from "./message-templates.controller.js";
import { MessageTemplatesService } from "./message-templates.service.js";

/**
 * Text templates (B73). Exports the service so other modules can fill in and send a template (applications now,
 * payment reminders later). Express equivalent: a module that both mounts a router and exports a helper.
 */
@Module({
  imports: [TypeOrmModule.forFeature([MessageTemplate])],
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesService],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
