import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { Payment } from "../payments/payment.entity.js";
import { User } from "../users/user.entity.js";
import { LedgerEntry } from "./ledger-entry.entity.js";
import { LedgerController } from "./ledger.controller.js";
import { LedgerService } from "./ledger.service.js";

/**
 * The driver ledger (D58). Exports `LedgerService` so payments and matching can credit payments inside their own
 * transactions. `forFeature` lists every entity the ledger touches, including relation targets (autoLoadEntities).
 */
@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry, Driver, Payment, User])],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
