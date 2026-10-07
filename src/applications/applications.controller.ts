import { Body, Controller, Post } from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator.js";
import { ApplicationsService } from "./applications.service.js";
import { ApplicationReceivedDto } from "./dto/application-received.dto.js";

/** Driver application routes, all under `/applications`. */
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
}
