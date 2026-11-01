import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { UploadTooLargeFilter } from "../applications/documents/upload-errors.filter.js";
import { MAX_UPLOAD_BYTES } from "../applications/documents/upload-file.js";
import { DriversService, type NewDriverFiles } from "./drivers.service.js";
import { AddAliasDto } from "./dto/add-alias.dto.js";
import { CreateDriverDto } from "./dto/create-driver.dto.js";
import { UpdateDriverProfileDto } from "./dto/driver-profile.dto.js";
import { DriverDetailDto, DriverListDto } from "./dto/driver.dto.js";
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

  /**
   * `POST /drivers`: an admin adds a driver directly, without an application (D85). Multipart form data: the text fields
   * (name, email and phone are required; the profile and `aliases`, a JSON list of `{type, value}`, are optional) and the
   * optional files `licenseFile` and `earningsFile` (JPG, PNG or PDF, at most 10 MB each). The driver starts in
   * onboarding with no login, and nothing is texted. `409` when a driver already has the email, or an alias
   * already belongs to another driver; nothing is saved then. Answers with the new driver.
   *
   * The interceptor is multer, the library you would mount as `upload.fields([...])` in Express: it reads the multipart
   * body, keeps the files in memory and leaves the text fields in `@Body()`, where the global ValidationPipe checks them.
   */
  @Post()
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "licenseFile", maxCount: 1 },
        { name: "earningsFile", maxCount: 1 },
      ],
      { limits: { fileSize: MAX_UPLOAD_BYTES } },
    ),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["firstName", "lastName", "email", "phone"],
      properties: {
        firstName: { type: "string" },
        middleName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        street: { type: "string" },
        apt: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zip: { type: "string" },
        dateOfBirth: { type: "string", description: "YYYY-MM-DD" },
        hasInsurance: { type: "string", description: "true or false" },
        aliases: {
          type: "string",
          description:
            'JSON list, e.g. [{"type":"zelle","value":"Pat Example"}]',
        },
        licenseFile: { type: "string", format: "binary" },
        earningsFile: { type: "string", format: "binary" },
      },
    },
  })
  create(
    @Body() body: CreateDriverDto,
    @UploadedFiles()
    files: Partial<
      Record<"licenseFile" | "earningsFile", Express.Multer.File[]>
    >,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDetailDto> {
    const single: NewDriverFiles = {
      license: files.licenseFile?.[0],
      earnings: files.earningsFile?.[0],
    };
    return this.drivers.create(body, single, admin.id);
  }

  /** `GET /drivers/:id`: one driver. `400` for a malformed id, `404` if unknown. */
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<DriverDetailDto> {
    return this.drivers.findOne(id);
  }

  /**
   * `PATCH /drivers/:id/profile`: changes the profile fields (middle name, address, date of birth, insurance, D85). A
   * field left out stays; one sent empty is cleared. Returns the updated driver.
   */
  @Patch(":id/profile")
  updateProfile(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateDriverProfileDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDetailDto> {
    return this.drivers.updateProfile(id, body, admin.id);
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
  ): Promise<DriverDetailDto> {
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
  ): Promise<DriverDetailDto> {
    return this.drivers.addAlias(id, body, admin.id);
  }

  /** `DELETE /drivers/:id/aliases/:aliasId`: removes one of the driver's aliases. Returns the updated driver. */
  @Delete(":id/aliases/:aliasId")
  removeAlias(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("aliasId", ParseUUIDPipe) aliasId: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDetailDto> {
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
  ): Promise<DriverDetailDto> {
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
  ): Promise<DriverDetailDto> {
    return this.drivers.sendToCollections(id, body.reason, admin.id);
  }

  /** `POST /drivers/:id/remove-from-collections`: takes the driver out of collections; they stay inactive. */
  @Post(":id/remove-from-collections")
  @HttpCode(HttpStatus.OK)
  removeFromCollections(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDetailDto> {
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
  ): Promise<DriverDetailDto> {
    return this.drivers.archive(id, admin.id);
  }

  /** `POST /drivers/:id/unarchive`: brings an archived driver back, with the status they had, and their application with them (D84). */
  @Post(":id/unarchive")
  @HttpCode(HttpStatus.OK)
  unarchive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDetailDto> {
    return this.drivers.unarchive(id, admin.id);
  }

  /** `POST /drivers/:id/reactivate`: back to `active` (all steps done) or `onboarding`; login works again. */
  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DriverDetailDto> {
    return this.drivers.reactivate(id, admin.id);
  }
}
