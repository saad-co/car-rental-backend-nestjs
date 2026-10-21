import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";
import { ContractCompany } from "./contract-company.entity.js";
import { Contract } from "./contract.entity.js";
import { ContractsController } from "./contracts.controller.js";
import { ContractsService } from "./contracts.service.js";

/** Driver contracts (Module 2): the draft and its rate calculator (D71, step 1) and its details (step 2). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, ContractCompany, Driver, User]),
  ],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
