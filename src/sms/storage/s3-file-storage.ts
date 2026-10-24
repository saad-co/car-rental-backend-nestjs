import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStorage } from "./file-storage.js";

export interface S3FileStorageOptions {
  /** Address of the S3 API: `http://localhost:9000` (MinIO) or `https://storage.railway.app`. */
  endpoint: string;
  /** `auto` for Railway; any value works for MinIO. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** True for MinIO: the bucket goes in the path (`host/bucket/key`), not in the host name. */
  forcePathStyle: boolean;
}

/**
 * `FileStorage` on any S3-compatible bucket, through the official AWS client. "S3" here is the protocol:
 * a Railway Storage Bucket and MinIO both speak it, so the same code serves staging and local development.
 *
 * Nothing in the bucket is public. A file is opened only through a link that `presignGet` signs for a few
 * minutes.
 */
export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3FileStorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      // Newer AWS clients add checksum fields by default, which several S3-compatible stores do not
      // understand. Only add them when the protocol requires it.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string | null,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType ?? undefined,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
    if (!result.Body)
      throw new Error(`The bucket returned no body for ${key}.`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** S3 answers success for a key that does not exist, so deleting twice is harmless. */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
  }

  /** Creates the bucket if it does not exist yet (`npm run storage:init`, local MinIO). Returns whether it did. */
  async ensureBucket(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.options.bucket }),
      );
      return false;
    } catch (error) {
      if (
        !(error instanceof S3ServiceException) ||
        error.$metadata.httpStatusCode !== 404
      )
        throw error;
    }
    await this.client.send(
      new CreateBucketCommand({ Bucket: this.options.bucket }),
    );
    return true;
  }
}
