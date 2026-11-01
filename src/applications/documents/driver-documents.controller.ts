import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes } from "@nestjs/swagger";
import { CurrentUser } from "../../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../../auth/jwt-auth.guard.js";
import { ApplicationDocumentKind } from "./application-document.entity.js";
import { ApplicationDocumentsService } from "./application-documents.service.js";
import type {
  ApplicationDocumentDto,
  ApplicationDocumentListDto,
} from "./dto/application-document.dto.js";
import { UploadTooLargeFilter } from "./upload-errors.filter.js";
import { MAX_UPLOAD_BYTES } from "./upload-file.js";

/**
 * A driver's documents on the driver page (D85), admin only (the global guard). A driver that came from an application
 * shows that application's files and replaces them in the same slots, so the two pages never disagree; a driver added
 * directly has its own. It lives with the application documents because it uses the same service, and the drivers module
 * must not import the applications module (the applications module already uses drivers).
 */
@Controller("drivers")
export class DriverDocumentsController {
  constructor(private readonly documents: ApplicationDocumentsService) {}

  /** `GET /drivers/:id/documents`: the driver's files, each with a short-lived link to open it. */
  @Get(":id/documents")
  list(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ApplicationDocumentListDto> {
    return this.documents.listForDriver(id);
  }

  /**
   * `PUT /drivers/:id/documents/:kind`: puts one file (multipart field `file`) in the licence, rating or earnings slot,
   * replacing what is there. JPG, PNG or PDF, at most 10 MB; `400` otherwise. Returns the slot.
   */
  @Put(":id/documents/:kind")
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  upload(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("kind", new ParseEnumPipe(ApplicationDocumentKind))
    kind: ApplicationDocumentKind,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<ApplicationDocumentDto> {
    if (!file) throw new BadRequestException("file is required.");
    return this.documents.uploadForDriver(id, kind, file, admin.id);
  }
}
