import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/jwt-auth.guard.js";
import {
  InspectionExportService,
  type ExportedFile,
} from "./inspection-export.service.js";

/** Sends bytes as a download: the browser saves them under `fileName`. */
function send(
  res: Response,
  file: ExportedFile,
  contentType: string,
): StreamableFile {
  res.set({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
    "Cache-Control": "private, no-store",
  });
  return new StreamableFile(file.data);
}

/**
 * Staff downloads of one inspection (Module 3 chat 2, step 4): all photos as a ZIP and a one-file PDF report. Admin only (the
 * global guard). The admin token travels in a header, so the page fetches these and saves the answer; a plain link would not
 * carry it.
 */
@Controller("inspections")
export class InspectionExportController {
  constructor(private readonly exports: InspectionExportService) {}

  /**
   * `GET /inspections/:id/export.zip`: every original photo, `<reference>/NN_<SHOT_ID>.jpg` and `damage_N.jpg`. A photo the
   * bucket cannot give is named in `MISSING.txt` inside. `404` unknown; `409` no photos; `503` no file storage.
   */
  @Get(":id/export.zip")
  async zip(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return send(res, await this.exports.zip(id, admin.id), "application/zip");
  }

  /** `GET /inspections/:id/report.pdf`: the one-file report. `404` unknown; `503` no file storage. */
  @Get(":id/report.pdf")
  async report(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return send(
      res,
      await this.exports.report(id, admin.id),
      "application/pdf",
    );
  }
}
