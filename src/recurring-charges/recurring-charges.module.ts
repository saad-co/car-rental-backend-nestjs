import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ContractsModule } from "../contracts/contracts.module.js";
import { Driver } from "../drivers/driver.entity.js";
import { RecurringCharge } from "./recurring-charge.entity.js";
import { RecurringChargesController } from "./recurring-charges.controller.js";
import { RecurringChargesService } from "./recurring-charges.service.js";

/** The daily or weekly rent set by hand for a driver with no signed contract (D100). Billing itself stays in the contracts module's rent job. */
@Module({
  imports: [
    TypeOrmModule.forFeature([RecurringCharge, Driver]),
    ContractsModule,
  ],
  controllers: [RecurringChargesController],
  providers: [RecurringChargesService],
})
export class RecurringChargesModule {}
