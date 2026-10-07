/**
 * Response of `POST /applications`. Same shape as the old backend's response, so the website
 * can call both backends without handling two formats (hence snake_case).
 */
export class ApplicationReceivedDto {
  /** Always `"received"`. */
  status: "received";
  /** Our id for the application. A repeated submission (same `request_id`) gets the same id. */
  application_id: string;
}
