import { ApplicationDocumentKind } from "../documents/application-document.entity.js";
import type { ManualApplicationDto } from "./manual-application.dto.js";

/** The files an admin attaches while adding an application, by slot (each is optional except the licence). */
export type ManualApplicationFiles = Partial<
  Record<ApplicationDocumentKind, Express.Multer.File>
>;

/** Browser file names can be long or odd; keep a readable, bounded one for the page. */
function shortName(file: Express.Multer.File): string {
  return file.originalname.slice(0, 200);
}

/**
 * The `payload` of a hand-typed application: the website's keys and value formats (D68), so the admin screens show
 * it exactly like a website one, plus `source: "admin"` to tell them apart. Empty optional answers are left out.
 */
export function manualPayload(
  fields: ManualApplicationDto,
  files: ManualApplicationFiles,
): Record<string, unknown> {
  const answers = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  // "How much do you have to get started" is asked only when the first week and deposit are not covered.
  if (fields.has_startup_funds === "yes") delete answers.capital;
  const license = files[ApplicationDocumentKind.license];
  const rating = files[ApplicationDocumentKind.rating];
  const earnings = files[ApplicationDocumentKind.earnings];
  return {
    ...answers,
    source: "admin",
    locale: "en",
    submitted_at: new Date().toISOString(),
    has_license_file: license !== undefined,
    ...(license && { license_file_name: shortName(license) }),
    has_rating_file: rating !== undefined,
    ...(rating && { rating_file_name: shortName(rating) }),
    has_earnings_file: earnings !== undefined,
    earnings_count: earnings ? 1 : 0,
  };
}
