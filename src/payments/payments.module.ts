import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LedgerModule } from "../ledger/ledger.module.js";
import { Payment } from "./payment.entity.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

/**
 * Payments (spec section 4): the admin list. The email intake writes payments; matching comes with M4.
 * Exports `TypeOrmModule` so other modules (the intake) can inject the `Payment` repository.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment]), LedgerModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
