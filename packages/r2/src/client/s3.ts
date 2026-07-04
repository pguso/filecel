import { S3Client } from "@aws-sdk/client-s3";
import type { R2ClientConfig } from "../types.js";

export function createS3Client(config: R2ClientConfig): S3Client {
  const endpoint =
    config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: config.region ?? "auto",
    endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    forcePathStyle: true
  });
}

