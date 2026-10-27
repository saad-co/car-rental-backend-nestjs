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
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { Public } from "../auth/public.decorator.js";
import { ApplicationStatus } from "./application.entity.js";
import { ApplicationsService } from "./applications.service.js";
import { ApplicationDocumentCopier } from "./documents/application-document-copier.js";
import {
  ApplicationDetailDto,
  ApplicationListDto,
  ApprovedApplicationListDto,
} from "./dto/application.dto.js";
import { ApplicationReceivedDto } from "./dto/application-received.dto.js";
import { ReviewMessageDto } from "./dto/review-message.dto.js";
import {
  DeleteApplicationsDto,
  DeleteApplicationsResultDto,
} from "./dto/delete-applications.dto.js";
import { ListApplicationsQueryDto } from "./dto/list-applications-query.dto.js";
import { UploadTooLargeFilter } from "./documents/upload-errors.filter.js";
import { MAX_UPLOAD_BYTES } from "./documents/upload-file.js";
import { ManualApplicationDto } from "./manual/manual-application.dto.js";
import { ManualApplicationQueryDto } from "./manual/manual-application-query.dto.js";
import { ManualApplicationCreatedDto } from "./manual/manual-application-created.dto.js";
import type { ManualApplicationFiles } from "./manual/manual-payload.js";

/**
 * Driver application routes, all under `/applications`.
 * Only `POST` is public; the others need a logged-in admin (the global JwtAuthGuard).
 */
@Controller("applications")
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly documents: ApplicationDocumentCopier,
  ) {}

  /**
   * `POST /applications`: receives a driver application from the gonzocar.com form.
   *
   * Public: applicants have no account. The body is typed `unknown` instead of a DTO class,
   * so the global ValidationPipe leaves it alone and ApplicationsService does the (lenient)
   * checks. Answers `201` with the same body for a new or a repeated submission.
   */
  @Public()
  @Post()
  @ApiBody({
    description:
      "The website's application JSON (snake_case fields, values mostly strings). " +
      "Required: request_id, first_name, last_name, email, phone. Other fields are kept as sent.",
    schema: { type: "object", additionalProperties: true },
  })
  async receive(@Body() body: unknown): Promise<ApplicationReceivedDto> {
    const { application, created } = await this.applications.receive(body);
    // The applicant's documents are copied into our storage right away, without making the website wait (D54).
    if (created) this.documents.runInBackground();
    return { status: "received", application_id: application.id };
  }

  /**
   * `POST /applications/manual`: an admin types in an application by hand, with its documents (D68). Same fields and
   * rules as the website form. It is approved straight away (D79). Approving creates no driver (D80): with
   * `?startOnboarding=true` ("Add driver") the driver is created too and the result carries its `driverId`; without
   * it ("Add application") `driverId` is null.
   * Admin only (no `@Public`). Multipart form data: the text fields plus the files `license_file` (required),
   * `rating_file` and `earnings_file` (JPG, PNG or PDF, at most 10 MB each). The file fields end in `_file` because
   * `earnings` is already a text field (weekly earnings).
   *
   * The interceptor is multer, the library you would mount as `upload.fields([...])` in Express: it reads the
   * multipart body, keeps the files in memory and leaves the text fields in `@Body()`, where the global
   * ValidationPipe checks them against `ManualApplicationDto`.
   *
   * `201` with `created: false` when the same `request_id` was already stored.
   */
  @Post("manual")
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "license_file", maxCount: 1 },
        { name: "rating_file", maxCount: 1 },
        { name: "earnings_file", maxCount: 1 },
      ],
      { limits: { fileSize: MAX_UPLOAD_BYTES } },
    ),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: [
        "request_id",
        "first_name",
        "last_name",
        "email",
        "phone",
        "street",
        "city",
        "zip",
        "age",
        "years_driving",
        "violations",
        "accidents",
        "platforms",
        "start_date",
        "duration",
        "has_startup_funds",
        "has_insurance",
        "has_insurance_last_45_days",
        "license_file",
      ],
      properties: {
        request_id: { type: "string", format: "uuid" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        street: { type: "string" },
        apt: { type: "string" },
        city: { type: "string" },
        zip: { type: "string" },
        age: { type: "string" },
        years_driving: { type: "string" },
        violations: { type: "string" },
        accidents: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        driver_rating: { type: "string" },
        earnings: { type: "string" },
        previous_companies: { type: "string" },
        referred_by: { type: "string" },
        start_date: { type: "string" },
        duration: { type: "string" },
        has_startup_funds: { type: "string" },
        capital: {
          type: "string",
          description:
            "Required, as an amount in USD, only when has_startup_funds is no",
        },
        has_insurance: { type: "string" },
        has_insurance_last_45_days: { type: "string" },
        license_file: { type: "string", format: "binary" },
        rating_file: { type: "string", format: "binary" },
        earnings_file: { type: "string", format: "binary" },
      },
    },
  })
  createManual(
    @Body() body: ManualApplicationDto,
    @Query() options: ManualApplicationQueryDto,
    @UploadedFiles()
    files: Partial<
      Record<
        "license_file" | "rating_file" | "earnings_file",
        Express.Multer.File[]
      >
    >,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ManualApplicationCreatedDto> {
    const single: ManualApplicationFiles = {
      license: files.license_file?.[0],
      rating: files.rating_file?.[0],
      earnings: files.earnings_file?.[0],
    };
    return this.applications.createManual(
      body,
      single,
      admin.id,
      options.startOnboarding === true,
    );
  }

  /**
   * `GET /applications`: one page of applications, newest first.
   *
   * `@Query()` collects the query string into the DTO and validates it, the same way
   * `@Body()` does for a request body. An invalid value (e.g. `status=foo`) is a `400`.
   */
  @Get()
  list(@Query() query: ListApplicationsQueryDto): Promise<ApplicationListDto> {
    return this.applications.list(query);
  }

  /**
   * `GET /applications/approved`: the Approved applications page (D80): approved applications whose onboarding is not
   * finished (no driver yet, or the driver is still in onboarding), with the onboarding progress. Same search, dates and
   * `archived` switch as the main list. Declared before `:id` so "approved" is never read as an id.
   */
  @Get("approved")
  listApproved(
    @Query() query: ListApplicationsQueryDto,
  ): Promise<ApprovedApplicationListDto> {
    return this.applications.listApproved(query);
  }

  /**
   * `POST /applications/bulk-delete`: deletes applications for good, with their documents and (when no one else
   * uses the phone) their text history (B66). All or nothing: `409` if any is approved, and then nothing is
   * deleted. Unknown ids are ignored.
   *
   * POST with a body rather than DELETE: a DELETE request with a body is poorly supported by proxies and HTTP
   * clients. Declared before `:id` routes so "bulk-delete" is never read as an id (it is also a POST, so it
   * could not clash with `GET :id` anyway).
   */
  @Post("bulk-delete")
  @HttpCode(HttpStatus.OK)
  bulkDelete(
    @Body() body: DeleteApplicationsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<DeleteApplicationsResultDto> {
    return this.applications.deleteMany(body.ids, admin.id);
  }

  /**
   * `GET /applications/:id`: one application with its full details.
   *
   * `ParseUUIDPipe` rejects an id that is not a UUID with `400` before any query runs
   * (Postgres would otherwise fail on it with a 500). A valid but unknown id is a `404`.
   */
  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ApplicationDetailDto> {
    return this.applications.findOne(id);
  }

  /**
   * `POST /applications/:id/approve`: marks the application approved and texts the applicant. No driver is created
   * (D80); "Start onboarding" does that. Optional body `{ "message": "..." }` is the approval text the admin picked and edited (B81); without
   * it the first approved template is sent. `400` for an unknown placeholder in it.
   *
   * POST because it is an action with side effects, not an edit of a field. `@HttpCode(200)`
   * because it returns the updated application rather than creating a resource at this URL.
   */
  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReviewMessageDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.approve(id, admin.id, { message: body.message });
  }

  /**
   * `POST /applications/:id/reject`: declines the application (shown as "Declined", B69). No driver is created.
   * Optional body `{ "message": "..." }` texts the applicant that declined text, as the admin picked and edited
   * it (B72, B81); without a message nothing is sent. `503` if the text could not be sent (then nothing is declined).
   */
  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReviewMessageDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.setStatus(
      id,
      ApplicationStatus.rejected,
      admin.id,
      { message: body.message },
    );
  }

  /** `POST /applications/:id/hold`: puts the application on hold to decide later. */
  @Post(":id/hold")
  @HttpCode(HttpStatus.OK)
  hold(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.setStatus(id, ApplicationStatus.on_hold, admin.id);
  }

  /**
   * `POST /applications/:id/start-onboarding`: for an approved application, creates the driver (in onboarding) and
   * their login (D80). `409` if it is not approved, is archived, already has its driver, or a driver or login already
   * has this email or phone.
   */
  @Post(":id/start-onboarding")
  @HttpCode(HttpStatus.OK)
  startOnboarding(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.startOnboarding(id, admin.id);
  }

  /**
   * `POST /applications/:id/archive`: hides the application from the normal list (D80); delete stays separate. Its
   * driver, whatever the status, is archived with it (D84), which stops billing and reminders.
   */
  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  archive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.archive(id, admin.id);
  }

  /** `POST /applications/:id/unarchive`: brings an archived application (and its driver, D84) back. */
  @Post(":id/unarchive")
  @HttpCode(HttpStatus.OK)
  unarchive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.unarchive(id, admin.id);
  }
}
