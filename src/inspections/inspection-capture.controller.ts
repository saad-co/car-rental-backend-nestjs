import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes } from "@nestjs/swagger";
import { UploadTooLargeFilter } from "../applications/documents/upload-errors.filter.js";
import { MAX_UPLOAD_BYTES } from "../applications/documents/upload-file.js";
import { Public } from "../auth/public.decorator.js";
import {
  CaptureStateDto,
  SetLanguageDto,
  SubmitInspectionDto,
  SubmittedInspectionDto,
  UploadedPhotoDto,
  UploadPhotoDto,
} from "./dto/capture.dto.js";
import { InspectionCaptureService } from "./inspection-capture.service.js";
import { TokenRateLimitGuard } from "./token-rate-limit.guard.js";

/**
 * The public routes of the vehicle-photo page, `/i/:token` (Module 3, D102). No login: `@Public()` switches the app-wide
 * login check off for this controller, and the link's token is the identity. Rate limited per address, on these routes only.
 *
 * Express comparison: a router mounted outside the auth middleware, with its own rate-limit middleware.
 */
@Public()
@UseGuards(TokenRateLimitGuard)
@Controller("i/:token")
export class InspectionCaptureController {
  constructor(private readonly capture: InspectionCaptureService) {}

  /**
   * `GET /i/:token`: what the page shows. Always `200`: `state` is `open` (with the vehicle, the shot list, the photos already
   * received and any damage recorded at check-in), `submitted`, `revoked` or `expired`. An unknown token reads `expired`. The first
   * read of an open link marks it opened.
   */
  @Get()
  state(@Param("token") token: string): Promise<CaptureStateDto> {
    return this.capture.state(token);
  }

  /**
   * `PUT /i/:token/photos/:shotId`: stores one photo, as multipart form data: the file `photo` (a JPEG, at most 10 MB) and the
   * optional text fields `position` (damage only, 1 to 15), `note`, `capturedAt`, `odometerMiles` (shot `INT_ODOMETER`) and
   * `fuelLevel` (shot `INT_FUEL`). `shotId` is a required shot or `DAMAGE`. Safe to repeat: the same file changes nothing, a
   * different one is a retake. Without a file it only updates the note or reading of a photo already stored.
   * `410` expired, unknown or revoked link; `409` already submitted; `400` bad input.
   */
  @Put("photos/:shotId")
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(
    FileInterceptor("photo", { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        photo: { type: "string", format: "binary" },
        position: {
          type: "integer",
          description: "Damage photos only, 1 to 15",
        },
        note: { type: "string" },
        capturedAt: { type: "string", description: "ISO 8601, from the phone" },
        odometerMiles: {
          type: "integer",
          description: "Only with INT_ODOMETER",
        },
        fuelLevel: {
          type: "string",
          enum: [
            "empty",
            "1_8",
            "1_4",
            "3_8",
            "1_2",
            "5_8",
            "3_4",
            "7_8",
            "full",
          ],
          description: "Only with INT_FUEL",
        },
      },
    },
  })
  uploadPhoto(
    @Param("token") token: string,
    @Param("shotId") shotId: string,
    @Body() body: UploadPhotoDto,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ): Promise<UploadedPhotoDto> {
    return this.capture.uploadPhoto(token, shotId, body, photo);
  }

  /**
   * `POST /i/:token/submit`: closes the inspection. Needs every required photo, the mileage, the fuel level and
   * `attested: true`; `gpsLat` and `gpsLng` (both or neither) and `deviceInfo` are optional. Repeating it after success returns the
   * same answer. `410` expired link; `400` something missing.
   */
  @Post("submit")
  @HttpCode(HttpStatus.OK)
  submit(
    @Param("token") token: string,
    @Body() body: SubmitInspectionDto,
  ): Promise<SubmittedInspectionDto> {
    return this.capture.submit(token, body);
  }

  /** `POST /i/:token/language`: saves the driver's language (`en` or `es`) on the driver record. `410` expired link; `409` already submitted. */
  @Post("language")
  @HttpCode(HttpStatus.OK)
  setLanguage(
    @Param("token") token: string,
    @Body() body: SetLanguageDto,
  ): Promise<SetLanguageDto> {
    return this.capture.setLanguage(token, body.language);
  }
}
