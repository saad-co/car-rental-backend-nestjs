import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Payment } from "./payment.entity.js";

/**
 * Payments (spec section 4). For now it only registers the `Payment` entity, so the running API knows the
 * `payments` table. The email intake writes payments; matching and the admin pages come with M4.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
