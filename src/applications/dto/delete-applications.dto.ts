import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

/** Most applications one request may delete (one list page is at most 100 rows). */
export const MAX_DELETE_BATCH = 100;

/** Body of `POST /applications/bulk-delete`. One id deletes one application. */
export class DeleteApplicationsDto {
  /** The applications to delete. Ids that no longer exist are ignored. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DELETE_BATCH)
  @IsUUID("all", { each: true })
  ids: string[];
}

/** What `POST /applications/bulk-delete` removed. */
export class DeleteApplicationsResultDto {
  /** Applications removed from the database. */
  deleted: number;
  /**
   * Copied files (documents, texted-in files) that could not be removed from the bucket. The database rows are
   * gone either way; the reason for each is in the server log. 0 when everything was removed.
   */
  filesNotRemoved: number;
}
