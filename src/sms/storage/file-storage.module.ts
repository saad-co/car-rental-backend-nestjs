import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FileStorage } from "./file-storage.js";
import { S3FileStorage } from "./s3-file-storage.js";

/** Injection token for our file bucket (`FileStorage | null`). */
export const FILE_STORAGE = Symbol("FILE_STORAGE");

/**
 * The one place our private file bucket (S3-compatible: MinIO locally, a Railway Storage Bucket on staging) is
 * built from the settings. Everything that stores files (texted-in files, application documents) injects
 * `FILE_STORAGE` from here, so there is one connection and one set of `S3_*` settings.
 *
 * With no `S3_BUCKET` the provider is `null`: files stay "pending" instead of failing (the `S3_*` settings are
 * validated together in `env.validation.ts`).
 */
@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FileStorage | null =>
        config.get<string>("S3_BUCKET")
          ? new S3FileStorage({
              endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
              region: config.getOrThrow<string>("S3_REGION"),
              bucket: config.getOrThrow<string>("S3_BUCKET"),
              accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
              secretAccessKey: config.getOrThrow<string>(
                "S3_SECRET_ACCESS_KEY",
              ),
              forcePathStyle:
                config.get<string>("S3_FORCE_PATH_STYLE") === "true",
            })
          : null,
    },
  ],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
