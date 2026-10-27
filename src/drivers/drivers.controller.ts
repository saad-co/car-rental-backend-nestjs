import {
  Body,
  Controller,
  Delete,
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
import { DriversService } from "./drivers.service.js";
import { AddAliasDto } from "./dto/add-alias.dto.js";
import { DriverDto, DriverListDto } from "./dto/driver.dto.js";
import {
  DeactivateDriverDto,
  SendToCollectionsDto,
} from "./dto/leaving.dto.js";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto.js";
import { SetOnboardingStepDto } from "./dto/set-onboarding-step.dto.js";

/** Admin driver routes under `/drivers`. All need a logged-in admin (global JwtAuthGuard). */
@Controller("drivers")
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  /** `GET /drivers`: one page of drivers, newest first. */
  @Get()
  list(@Query() query: ListDriversQueryDto): Promise<DriverListDto> {
    return this.drivers.list(query);
  }

  /** `GET /drivers/:id`: one driver. `400` for a malformed id, `404` if unknown. */
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<DriverDto> {
    return this.drivers.findOne(id);
  }

  /**
   * `POST /drivers/:id/onboarding`: ticks or un-ticks one onboarding step (D56). The driver becomes `active` when
   * the third step is ticked, and goes back to `onboarding` when one is un-ticked. Returns the updated driver.
   * `409` if the driver is inactive.
   */
  @Post(":id/onboarding")
  @HttpCode(HttpStatus.OK)
  setOnboardingStep(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SetOnboardingStepDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.setOnboardingStep(
      id,
      body.step,
      body.done,
      admin.id,
      body.depositPaidCents,
    );
  }

  /**
   * `POST /drivers/:id/aliases`: adds a payment alias (a name or handle the driver pays from, per payment method) so
   * their payments match automatically (D69). `409` with the owner's name when another driver already has it.
   * Returns the updated driver.
   */
  @Post(":id/aliases")
  addAlias(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AddAliasDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.addAlias(id, body, admin.id);
  }

  /** `DELETE /drivers/:id/aliases/:aliasId`: removes one of the driver's aliases. Returns the updated driver. */
  @Delete(":id/aliases/:aliasId")
  removeAlias(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("aliasId", ParseUUIDPipe) aliasId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.removeAlias(id, aliasId, admin.id);
  }

  /**
   * `POST /drivers/:id/deactivate`: the driver left (B67), and how: `reason` is required (D81). Their login stops
   * working at once.
   */
  @Post(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DeactivateDriverDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.deactivate(id, body.reason, admin.id);
  }

  /**
   * `POST /drivers/:id/collections`: sends the driver to collections (D81). `reason` is needed when no reason is noted
   * yet; the driver is then deactivated in the same step. `409` for a driver still in onboarding.
   */
  @Post(":id/collections")
  @HttpCode(HttpStatus.OK)
  sendToCollections(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SendToCollectionsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.sendToCollections(id, body.reason, admin.id);
  }

  /** `POST /drivers/:id/remove-from-collections`: takes the driver out of collections; they stay inactive. */
  @Post(":id/remove-from-collections")
  @HttpCode(HttpStatus.OK)
  removeFromCollections(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.removeFromCollections(id, admin.id);
  }

  /**
   * `POST /drivers/:id/archive`: hides the driver from the normal list and stops billing and reminders (D80). Any
   * driver, no need to deactivate first; drivers are archived, never deleted. The application they came from is
   * archived with them (D84).
   */
  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  archive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.archive(id, admin.id);
  }

  /** `POST /drivers/:id/unarchive`: brings an archived driver back, with the status they had, and their application with them (D84). */
  @Post(":id/unarchive")
  @HttpCode(HttpStatus.OK)
  unarchive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.unarchive(id, admin.id);
  }

  /** `POST /drivers/:id/reactivate`: back to `active` (all steps done) or `onboarding`; login works again. */
  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDto> {
    return this.drivers.reactivate(id, admin.id);
  }
}
