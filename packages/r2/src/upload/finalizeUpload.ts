import type { S3Client } from "@aws-sdk/client-s3";

import type { UploadBufferOptions, UploadFromUrlOptions, UploadFromUrlResult } from "../types.js";
import { getPublicUrl } from "../urls/getPublicUrl.js";
import {
  bufferTransformSource,
  resolveTransformSourceFromR2,
  runTransformPipeline
} from "../transform/pipeline.js";

export type FinalizeUploadOptions = Pick<
  UploadFromUrlOptions,
  "transforms" | "transformErrorMode" | "variantKeyStrategy" | "maxBytes"
>;

export async function finalizeUpload(params: {
  s3: S3Client;
  bucket: string;
  key: string;
  etag?: string;
  size?: number;
  contentType?: string;
  publicBaseUrl?: string;
  options: FinalizeUploadOptions | UploadBufferOptions;
  sourceBuffer?: Uint8Array;
}): Promise<UploadFromUrlResult> {
  const { s3, bucket, key, etag, size, contentType, publicBaseUrl, options, sourceBuffer } = params;

  const publicUrl = publicBaseUrl ? getPublicUrl({ publicBaseUrl, key }) : undefined;
  const result: UploadFromUrlResult = { key, etag, size, contentType, publicUrl };

  const transforms = options.transforms;
  if (!transforms?.length) return result;

  const source =
    sourceBuffer !== undefined
      ? bufferTransformSource(sourceBuffer)
      : await resolveTransformSourceFromR2({
          s3,
          bucket,
          key,
          contentType,
          maxBytes: options.maxBytes
        });

  const variants = await runTransformPipeline({
    s3,
    bucket,
    originalKey: key,
    contentType,
    source,
    transforms,
    publicBaseUrl,
    variantKeyStrategy: options.variantKeyStrategy,
    transformErrorMode: options.transformErrorMode
  });

  return { ...result, variants };
}
