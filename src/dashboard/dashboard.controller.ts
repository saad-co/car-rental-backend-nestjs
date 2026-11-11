import { Controller, Get } from "@nestjs/common";
import { DailyOperationsService } from "./daily-ops.service.js";
import { DashboardService } from "./dashboard.service.js";
import { DashboardDto } from "./dto/dashboard.dto.js";
import { DailyOperationsDto } from "./dto/daily-ops.dto.js";

/**
 * The admin dashboard, under `/dashboard`. Admin only: a controller with no `@Roles(...)` is admin-only through the
 * global guard (D32).
 */
@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly dailyOperations: DailyOperationsService,
  ) {}

  /** `GET /dashboard`: every number on the dashboard in one response (money in cents, Chicago days). `401` no token. */
  @Get()
  get(): Promise<DashboardDto> {
    return this.dashboard.get();
  }

  /**
   * `GET /dashboard/daily-operations`: the daily operations page (D92): payments due today, late payments, early warning.
   * Computed from the ledger and the signed contracts when read. `401` no token.
   */
  @Get("daily-operations")
  dailyOperationsPage(): Promise<DailyOperationsDto> {
    return this.dailyOperations.get();
  }
}
