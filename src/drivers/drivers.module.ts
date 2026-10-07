import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Driver } from "./driver.entity.js";
import { DriversController } from "./drivers.controller.js";
import { DriversService } from "./drivers.service.js";

/** Drivers: the admin list and detail. Drivers are created by approving an application. */
@Module({
  imports: [TypeOrmModule.forFeature([Driver])],
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
