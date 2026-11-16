import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto.js";
import {
  CreateInspectionDto,
  InspectionDetailDto,
  InspectionDto,
  InspectionLinkDto,
  InspectionListDto,
  SendInspectionLinkDto,
} from "./dto/inspection.dto.js";
import { InspectionsService } from "./inspections.service.js";

/**
 * Staff routes for vehicle check-in / check-out inspections (Module 3, D102). Admin only (the global guard).
 * Express comparison: two routers, `/drivers/:id/inspections` and `/inspections/:id`, behind the app-wide auth middleware.
 * The driver's public routes (`/i/:token`) are a different controller.
 */
@Controller()
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  /** `GET /drivers/:id/inspections`: one page of the driver's inspections, newest first. `404` unknown driver. */
  @Get("drivers/:id/inspections")
  list(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<InspectionListDto> {
    return this.inspections.list(id, query);
  }

  /**
   * `POST /drivers/:id/inspections`: makes a check-in or check-out for the driver, or returns the open one of that type.
   * The vehicle is copied from the driver's signed contract; with none, send `vehicle`. `400` no vehicle, or one sent although
   * the contract has one; `404` unknown driver. No link exists yet: call `send` or `reissue`.
   */
  @Post("drivers/:id/inspections")
  create(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CreateInspectionDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<InspectionDto> {
    return this.inspections.create(id, body, admin.id);
  }

  /** `GET /inspections/:id`: one inspection with its activity log. `404` unknown. */
  @Get("inspections/:id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<InspectionDetailDto> {
    return this.inspections.findOne(id);
  }

  /**
   * `POST /inspections/:id/send`: texts the driver a fresh link (the old link stops working), in the driver's language,
   * through the Quo chat. The answer holds the link and what happened to the text (`dry_run` = saved only). `409` already
   * submitted, revoked, or the driver texted STOP; `502` Quo refused the text.
   */
  @Post("inspections/:id/send")
  @HttpCode(HttpStatus.OK)
  send(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<SendInspectionLinkDto> {
    return this.inspections.send(id, admin.id);
  }

  /**
   * `POST /inspections/:id/reissue`: makes a fresh link without texting it, for the admin to copy (the old link stops working).
   * `409` already submitted or revoked.
   */
  @Post("inspections/:id/reissue")
  @HttpCode(HttpStatus.OK)
  reissue(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<InspectionLinkDto> {
    return this.inspections.reissue(id, admin.id);
  }

  /** `POST /inspections/:id/revoke`: cancels the inspection; its link stops working for good. `409` already submitted or revoked. */
  @Post("inspections/:id/revoke")
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<InspectionDto> {
    return this.inspections.revoke(id, admin.id);
  }
}
