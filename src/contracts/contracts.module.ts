import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { User } from "../users/user.entity.js";
import { FIRMA_CLIENT, type FirmaClient } from "../firma/firma-client.js";
import { FirmaHttpClient } from "../firma/firma-http-client.js";
import { ContractCompany } from "./contract-company.entity.js";
import { Contract } from "./contract.entity.js";
import { ContractsController } from "./contracts.controller.js";
import { ContractsService } from "./contracts.service.js";

/**
 * Driver contracts (Module 2): the draft and its rate calculator (D71, step 1), its details (step 2) and sending it for
 * signing through firma (step 3, D74). Like the SMS module, the real firma client is built here from the settings and handed
 * to the service, so tests can give it a fake; with no key it is null.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, ContractCompany, Driver, User]),
  ],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    {
      provide: FIRMA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FirmaClient | null => {
        const apiKey = config.get<string>("FIRMA_API_KEY");
        return apiKey ? new FirmaHttpClient({ apiKey }) : null;
      },
    },
  ],
})
export class ContractsModule {}
