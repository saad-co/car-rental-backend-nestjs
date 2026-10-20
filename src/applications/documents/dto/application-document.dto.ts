import {
  ApplicationDocumentKind,
  ApplicationDocumentOrigin,
  ApplicationDocumentStatus,
} from "../application-document.entity.js";

/** One uploaded document of an application. */
export class ApplicationDocumentDto {
  id: string;
  /** Which upload on the form: licence, rating screenshot or earnings screenshot. */
  kind: ApplicationDocumentKind;
  /** `stored`: our copy can be opened; `pending`: still being copied; `failed`: it cannot be copied (see `error`). */
  status: ApplicationDocumentStatus;
  /** `website`: copied from the website's storage; `admin`: uploaded by an admin (D64). */
  origin: ApplicationDocumentOrigin;
  /** MIME type, e.g. `image/png`; null if unknown. */
  contentType: string | null;
  sizeBytes: number | null;
  /** Short-lived link (about 10 minutes) to open our copy. Null unless `stored`. */
  url: string | null;
  /** Why it could not be copied, in plain words. Null if it did not fail. */
  error: string | null;
  /** The admin who uploaded it (admin uploads only; also null if that account was removed). */
  uploadedByEmail: string | null;
}

/** The documents of one application. */
export class ApplicationDocumentListDto {
  items: ApplicationDocumentDto[];
  /** Whether the website's document function is connected (`DOCUMENTS_SOURCE_*`); without it nothing can be copied. */
  sourceConnected: boolean;
  /** Whether our file bucket is connected (`S3_*`); without it nothing can be stored. */
  storageConnected: boolean;
}
