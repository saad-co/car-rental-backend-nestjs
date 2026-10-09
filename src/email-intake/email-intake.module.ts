import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InboundEmail } from "./inbound-email.entity.js";

/**
 * Payment email intake (spec M3).
 *
 * For now it only registers the `InboundEmail` entity. `forFeature([...])` makes a `Repository`
 * for it injectable in this module, and is also how `autoLoadEntities` learns that the entity
 * exists, so the running API knows the `inbound_emails` table. The fetching and processing
 * services will be added here later.
 */
@Module({
  imports: [TypeOrmModule.forFeature([InboundEmail])],
})
export class EmailIntakeModule {}
