import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { Response } from "express";
import { UPLOAD_FILE_MESSAGE } from "./upload-file.js";

/**
 * Multer stops a file over the size limit before our code runs, and Nest turns that into `413 File too large`. The
 * admin screens show one plain sentence for every bad upload, so on the upload routes this makes it a `400` with
 * that sentence (the same one `checkUpload` uses for a wrong type).
 *
 * Express comparison: an error-handling middleware (`(err, req, res, next)`) mounted only on these routes.
 */
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const replacement = new BadRequestException(UPLOAD_FILE_MESSAGE);
    response.status(replacement.getStatus()).json(replacement.getResponse());
  }
}
