/**
 * Where files texted in by contacts are kept: an S3-compatible bucket (MinIO locally, a Railway Storage Bucket
 * on staging, D50). Behind an interface so tests use an in-memory fake.
 */
export interface FileStorage {
  /** Stores `body` under `key` (overwrites). Throws on any failure. */
  put(key: string, body: Buffer, contentType: string | null): Promise<void>;

  /** The file's bytes. Throws when the key does not exist or on any other failure. */
  get(key: string): Promise<Buffer>;

  /** A link that opens the file for `expiresInSeconds`, then stops working. Nothing is public. */
  presignGet(key: string, expiresInSeconds: number): Promise<string>;

  /** Removes the file under `key`. A key that is already gone is not an error. Throws on any other failure. */
  delete(key: string): Promise<void>;
}

/** How long a file link stays valid. The chat asks again whenever it reloads. */
export const FILE_LINK_SECONDS = 600;
