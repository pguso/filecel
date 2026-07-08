import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { fileTypeFromBuffer } from "file-type";

import type { Metadata, UploadBufferOptions, UploadBufferResult } from "../types.js";
import { UploadError, ValidationError } from "../errors.js";
import { finalizeUpload } from "./finalizeUpload.js";

function stripCharset(contentType: string): string {
  return contentType.split(";")[0]?.trim() ?? contentType.trim();
}

export async function uploadBuffer(params: {
  s3: S3Client;
  bucket: string;
  buffer: Uint8Array;
  options?: UploadBufferOptions;
  publicBaseUrl?: string;
}): Promise<UploadBufferResult> {
  const { s3, bucket, buffer } = params;
  const options = params.options ?? {};

  const size = buffer.byteLength;

  if (options.maxBytes !== undefined && size > options.maxBytes) {
    throw new ValidationError(`File exceeds maxBytes (${size} > ${options.maxBytes}).`);
  }

  let detectedContentType: string | undefined = options.contentType
    ? stripCharset(options.contentType)
    : undefined;

  if (!detectedContentType) {
    const ft = await fileTypeFromBuffer(buffer);
    detectedContentType = ft?.mime;
  }

  if (options.allowedMimeTypes?.length) {
    const ct = detectedContentType;
    if (!ct || !options.allowedMimeTypes.includes(ct)) {
      throw new ValidationError(
        `MIME type not allowed (${ct ?? "unknown"}). Allowed: ${options.allowedMimeTypes.join(", ")}`
      );
    }
  }

  const key = options.key;
  if (!key) {
    throw new ValidationError("key is required for uploadBuffer.");
  }

  const metadata: Metadata | undefined = options.metadata;

  try {
    const putRes = await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: detectedContentType,
        Metadata: metadata
      })
    );

    return finalizeUpload({
      s3,
      bucket,
      key,
      etag: putRes.ETag,
      size,
      contentType: detectedContentType,
      publicBaseUrl: params.publicBaseUrl,
      options,
      sourceBuffer: buffer
    });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new UploadError("Upload to R2 failed.", { key, cause: err });
  }
}
