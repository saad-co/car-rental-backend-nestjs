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
 * An application's documents, admin only (the global guard). Files open through short-lived signed links; the bucket
 * itself is private.
 */
@Controller("applications")
export class ApplicationDocumentsController {
  constructor(private readonly documents: ApplicationDocumentsService) {}

  /** `GET /applications/:id/documents`: the files, as our own copies (D54) or admin uploads (D64). */
  @Get(":id/documents")
  list(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ApplicationDocumentListDto> {
    return this.documents.list(id);
  }

  /**
   * `PUT /applications/:id/documents/:kind`: puts one file (multipart field `file`) in the licence, rating or earnings
   * slot, replacing what is there, a website copy included (D64). JPG, PNG or PDF, at most 10 MB; `400` otherwise.
   * Returns the slot. PUT because the slot ends up holding exactly this file however many times it is sent.
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
    return this.documents.upload(id, kind, file, admin.id);
  }
}
