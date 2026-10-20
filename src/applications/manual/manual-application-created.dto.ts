/** Response of `POST /applications/manual` (D68). */
export class ManualApplicationCreatedDto {
  /** The new application's id. */
  id: string;
  /** False when the same `request_id` had already been stored (a double click or a retry): nothing new was made. */
  created: boolean;
}
