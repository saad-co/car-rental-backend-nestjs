import { BadRequestException } from "@nestjs/common";
import { ApplicationDocumentKind } from "./application-document.entity.js";
import { sniffFileType, type SniffedFileType } from "./sniff-file-type.js";

/** The website's limit per file (10 MB), kept the same here. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The one sentence shown for a file that is too big or the wrong type, wherever the upload happens. */
export const UPLOAD_FILE_MESSAGE = "Only JPG, PNG or PDF files, at most 10 MB.";

/**
 * Checks one uploaded file (D64): not empty, at most 10 MB, and really a JPEG, PNG or PDF by its content.
 * @throws BadRequestException with `UPLOAD_FILE_MESSAGE` (and the field name) if it is not.
 */
export function checkUpload(
  label: string,
  file: Express.Multer.File,
): SniffedFileType {
  const type =
    file.size > 0 && file.size <= MAX_UPLOAD_BYTES
      ? sniffFileType(file.buffer)
      : null;
  if (!type) {
    throw new BadRequestException(`${label}: ${UPLOAD_FILE_MESSAGE}`);
  }
  return type;
}

/** The three document slots, in the order they are shown. */
export const DOCUMENT_KINDS = [
  ApplicationDocumentKind.license,
  ApplicationDocumentKind.rating,
  ApplicationDocumentKind.earnings,
] as const;

/** How a slot is named in messages. */
export const DOCUMENT_LABEL: Record<ApplicationDocumentKind, string> = {
  [ApplicationDocumentKind.license]: "Driver's licence",
  [ApplicationDocumentKind.rating]: "Rating screenshot",
  [ApplicationDocumentKind.earnings]: "Proof of earnings",
};

/** Where a document lives in our bucket: the same pattern the website copies use (D54). `id` makes every file's key new. */
export function documentStorageKey(
  applicationId: string,
  kind: ApplicationDocumentKind,
  id: string,
  extension: string,
): string {
  return `applications/${applicationId}/${kind}-${id}.${extension}`;
}
