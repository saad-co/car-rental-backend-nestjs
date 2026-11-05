import { Controller, Get } from "@nestjs/common";
import { DashboardService } from "./dashboard.service.js";
import { DashboardDto } from "./dto/dashboard.dto.js";

/**
 * The admin dashboard, under `/dashboard`. Admin only: a controller with no `@Roles(...)` is admin-only through the
 * global guard (D32).
 */
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** `GET /dashboard`: every number on the dashboard in one response (money in cents, Chicago days). `401` no token. */
  @Get()
  get(): Promise<DashboardDto> {
    return this.dashboard.get();
  }
}
