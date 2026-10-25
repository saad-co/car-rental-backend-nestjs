import { DriverStatus } from "../../drivers/driver.entity.js";
import { ApplicationStatus } from "../application.entity.js";

/**
 * Response shapes of the admin application endpoints.
 *
 * Responses are separate classes from the `Application` entity, so a new database column
 * is never sent to the browser by accident, and the OpenAPI document shows exactly what the
 * frontend receives. Dates are sent as ISO 8601 strings.
 */

/** One row of the applications list: only what the list screen shows. */
export class ApplicationListItemDto {
  id: string;
  status: ApplicationStatus;
  firstName: string;
  lastName: string;
  email: string;
  /** As the applicant typed it (usually 10 digits). */
  phone: string;
  city: string | null;
  /** When the applicant pressed submit, by their browser's clock. */
  submittedAt: Date | null;
  /** When our API received it. */
  receivedAt: Date;
  /** Why the alert text to staff about this application could not be sent; null if it did not fail. */
  alertError: string | null;
  /** When an admin archived it (D80); null = not archived. */
  archivedAt: Date | null;
}

/** The onboarding driver of an approved application, as the Approved applications page shows it. */
export class ApprovedApplicationDriverDto {
  id: string;
  /** `onboarding` here by definition: a driver who is `active` or `inactive` is on the Drivers page. */
  status: DriverStatus;
  /** The three onboarding steps (D56): when each was ticked; null while not done. */
  contractSignedAt: Date | null;
  depositPaidAt: Date | null;
  vehicleAssignedAt: Date | null;
}

/** One row of the Approved applications page (D80). */
export class ApprovedApplicationItemDto extends ApplicationListItemDto {
  /** Null until an admin presses "Start onboarding"; then the driver, while onboarding is not finished. */
  driver: ApprovedApplicationDriverDto | null;
}

/** One page of approved applications, newest first. */
export class ApprovedApplicationListDto {
  items: ApprovedApplicationItemDto[];
  total: number;
  page: number;
  limit: number;
}

/** One page of applications, newest first. */
export class ApplicationListDto {
  items: ApplicationListItemDto[];
  /** Number of applications matching the filter, across all pages. */
  total: number;
  page: number;
  limit: number;
}

/** The admin who typed an application in by hand (D68). */
export class ApplicationCreatedByDto {
  id: string;
  email: string;
}

/** Everything about one application, for the detail screen. */
export class ApplicationDetailDto extends ApplicationListItemDto {
  /** The website's id for the submission. */
  requestId: string;
  zip: string | null;
  /** Paths in the client's Supabase `driver-documents` bucket. */
  licenseStoragePath: string | null;
  ratingStoragePath: string | null;
  earningsStoragePath: string | null;
  /** The full submission as the website sent it, minus the bot-check token. */
  payload: Record<string, unknown>;
  /** The admin who last reviewed it. Null while pending. */
  reviewedById: string | null;
  reviewedAt: Date | null;
  /** The driver created by "Start onboarding" (D80). Null until then, and always null unless approved. */
  driverId: string | null;
  /** When the alert text to staff was really sent; null if it was not (off, dry run, or failed). */
  alertedAt: Date | null;
  /** The admin who added it by hand (D68). Null for applications that came from the website form. */
  createdBy: ApplicationCreatedByDto | null;
}
