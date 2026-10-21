import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { DriversModule } from "../drivers/drivers.module.js";
import { FileStorageModule } from "../sms/storage/file-storage.module.js";
import { User } from "../users/user.entity.js";
import { FIRMA_CLIENT, type FirmaClient } from "../firma/firma-client.js";
import { FirmaHttpClient } from "../firma/firma-http-client.js";
import { ContractCompany } from "./contract-company.entity.js";
import { Contract } from "./contract.entity.js";
import { ContractTrackingJob } from "./contract-tracking.job.js";
import { ContractTrackingService } from "./contract-tracking.service.js";
import { ContractsController } from "./contracts.controller.js";
import { ContractsService } from "./contracts.service.js";
import { FirmaWebhookController } from "./firma-webhook.controller.js";

/**
 * Driver contracts (Module 2): the draft and its rate calculator (D71, step 1), its details (step 2) and sending it for
 * signing through firma (step 3, D74), then following it and filing the signed copy (step 4, D75: the webhook, the scheduled
 * catch-up and the documents). Like the SMS module, the real firma client is built here from the settings and handed
 * to the service, so tests can give it a fake; with no key it is null.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Contract, ContractCompany, Driver, User]),
    // Signing ticks the driver's "Contract signed" step; the signed files go to the shared private bucket.
    DriversModule,
    FileStorageModule,
  ],
  controllers: [ContractsController, FirmaWebhookController],
  providers: [
    ContractsService,
    ContractTrackingService,
    ContractTrackingJob,
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
