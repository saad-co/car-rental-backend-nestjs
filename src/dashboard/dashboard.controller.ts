import { Controller, Get, Query } from "@nestjs/common";
import { CollectionsService } from "./collections.service.js";
import { DailyOperationsService } from "./daily-ops.service.js";
import {
  CollectionPeriodsDto,
  CollectionsQueryDto,
} from "./dto/collections.dto.js";
import { DayRangeQueryDto } from "./dto/day-range-query.dto.js";
import { RevenueByDriverDto } from "./dto/revenue-by-driver.dto.js";
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
    private readonly collections: CollectionsService,
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

  /**
   * `GET /dashboard/collections?view=monthly|weekly|daily`: confirmed payments received per month, Monday-to-Sunday week or
   * day (Chicago), newest first, paginated, with the total of the whole filter (page 2, D93). Optional `from` / `to` days
   * (a custom range). `400` a bad view or day, or `from` after `to`; `401` no token.
   */
  @Get("collections")
  collectionsPage(
    @Query() query: CollectionsQueryDto,
  ): Promise<CollectionPeriodsDto> {
    return this.collections.collections(query);
  }

  /**
   * `GET /dashboard/revenue-by-driver`: confirmed payments received per driver, biggest first, paginated, with the total of
   * the whole filter (page 2, D93). Optional `from` / `to` days. `400` a bad day, or `from` after `to`; `401` no token.
   */
  @Get("revenue-by-driver")
  revenueByDriver(
    @Query() query: DayRangeQueryDto,
  ): Promise<RevenueByDriverDto> {
    return this.collections.revenueByDriver(query);
  }
}
