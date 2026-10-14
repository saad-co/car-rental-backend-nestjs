/**
 * Developer tool: creates the file bucket in the S3-compatible store from your `.env` if it is missing
 * (local MinIO: `docker compose up -d minio` first). Changes nothing if the bucket exists. NOT part of the API.
 *
 *   npm run storage:init
 */
import { S3FileStorage } from "../src/sms/storage/s3-file-storage.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is missing. Add it to .env (see .env.example).`);
  return value;
}

const bucket = requireEnv("S3_BUCKET");
const storage = new S3FileStorage({
  endpoint: requireEnv("S3_ENDPOINT"),
  region: process.env.S3_REGION || "auto",
  bucket,
  accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
  secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

console.log(
  (await storage.ensureBucket())
    ? `Created bucket "${bucket}".`
    : `Bucket "${bucket}" already exists.`,
);
