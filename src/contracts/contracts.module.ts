import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";
import { Contract } from "./contract.entity.js";
import { ContractsController } from "./contracts.controller.js";
import { ContractsService } from "./contracts.service.js";

/** Driver contracts (Module 2): step 1 is the draft and its rate calculator (D71). */
@Module({
  imports: [TypeOrmModule.forFeature([Contract, Driver, User])],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
