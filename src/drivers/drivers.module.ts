import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PaymentAlias } from "../aliases/payment-alias.entity.js";
import { Payment } from "../payments/payment.entity.js";
import { Driver } from "./driver.entity.js";
import { DriversController } from "./drivers.controller.js";
import { DriversService } from "./drivers.service.js";

/** Drivers: the admin list and detail, with each driver's payment aliases and payment summary. */
@Module({
  imports: [TypeOrmModule.forFeature([Driver, PaymentAlias, Payment])],
  controllers: [DriversController],
  providers: [DriversService],
  // ContractsModule ticks "Contract signed" when a driver signs (D75).
  exports: [DriversService],
})
export class DriversModule {}
