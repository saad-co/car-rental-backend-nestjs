import { Module } from "@nestjs/common";
import { SmsModule } from "../sms/sms.module.js";
import { DashboardController } from "./dashboard.controller.js";
import { DailyOperationsService } from "./daily-ops.service.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * The admin dashboard (spec section 10, D88). Read-only: it owns no table and reads the others with plain SQL through the
 * shared database connection. It imports `SmsModule` only for the SMS mode.
 */
@Module({
  imports: [SmsModule],
  controllers: [DashboardController],
  providers: [DashboardService, DailyOperationsService],
})
export class DashboardModule {}
