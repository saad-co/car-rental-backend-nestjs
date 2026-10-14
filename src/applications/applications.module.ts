import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "../drivers/driver.entity.js";
import { SmsModule } from "../sms/sms.module.js";
import { UsersModule } from "../users/users.module.js";
import { Application } from "./application.entity.js";
import { ApplicationAlertService } from "./application-alert.service.js";
import { ApplicationsController } from "./applications.controller.js";
import { ApplicationsService } from "./applications.service.js";

/**
 * Driver applications: intake from the website and admin review.
 *
 * `forFeature([...])` makes a `Repository` for each entity injectable in this module, and is
 * also how `autoLoadEntities` learns which entities exist. `Driver` is listed because
 * `Application` has a relation to it: TypeORM refuses to start if a relation points at an
 * entity it does not know. `UsersModule` (PasswordService) and `SmsModule` are needed by
 * approval, which creates the driver's login and texts it (D52).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Application, Driver]),
    UsersModule,
    SmsModule,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicationAlertService],
})
export class ApplicationsModule {}
