import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PaymentAlias } from "../aliases/payment-alias.entity.js";
import { ApplicationDocument } from "../applications/documents/application-document.entity.js";
import { Payment } from "../payments/payment.entity.js";
import { FileStorageModule } from "../sms/storage/file-storage.module.js";
import { Driver } from "./driver.entity.js";
import { DriversController } from "./drivers.controller.js";
import { DriversService } from "./drivers.service.js";

/** Drivers: the admin list and detail, with each driver's payment aliases and payment summary. */
@Module({
  imports: [
    // ApplicationDocument: a driver added directly keeps its licence and earnings files there (D85).
    TypeOrmModule.forFeature([
      Driver,
      PaymentAlias,
      Payment,
      ApplicationDocument,
    ]),
    FileStorageModule,
  ],
  controllers: [DriversController],
  providers: [DriversService],
  // ContractsModule ticks "Contract signed" when a driver signs (D75).
  exports: [DriversService],
})
export class DriversModule {}
