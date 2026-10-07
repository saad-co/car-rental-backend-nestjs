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
import { ApiBody } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import { Public } from "../auth/public.decorator.js";
import { ApplicationStatus } from "./application.entity.js";
import { ApplicationsService } from "./applications.service.js";
import {
  ApplicationDetailDto,
  ApplicationListDto,
} from "./dto/application.dto.js";
import { ApplicationReceivedDto } from "./dto/application-received.dto.js";
import { ListApplicationsQueryDto } from "./dto/list-applications-query.dto.js";

/**
 * Driver application routes, all under `/applications`.
 * Only `POST` is public; the others need a logged-in admin (the global JwtAuthGuard).
 */
@Controller("applications")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

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
    const { application } = await this.applications.receive(body);
    return { status: "received", application_id: application.id };
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
   * `POST /applications/:id/approve`: creates the driver and marks the application approved.
   *
   * POST because it is an action with side effects, not an edit of a field. `@HttpCode(200)`
   * because it returns the updated application rather than creating a resource at this URL.
   */
  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.approve(id, admin.id);
  }

  /** `POST /applications/:id/reject`: rejects the application. No driver is created. */
  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDetailDto> {
    return this.applications.setStatus(
      id,
      ApplicationStatus.rejected,
      admin.id,
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
}
