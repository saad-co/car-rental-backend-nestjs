/** Response of `POST /applications/manual` (D68). */
export class ManualApplicationCreatedDto {
  /** The new application's id. */
  id: string;
  /** False when the same `request_id` had already been stored (a double click or a retry): nothing new was made. */
  created: boolean;
  /**
   * The driver created by approving it (D79). Null only for a repeat of a request whose approval has not finished, or
   * whose application an admin has since declined or put on hold.
   */
  driverId: string | null;
}
