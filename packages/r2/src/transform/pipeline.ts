import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { Transform, TransformVariantResult, VariantKeyStrategyInput } from "../types.js";
import { TransformError, ValidationError } from "../errors.js";
import { getPublicUrl } from "../urls/getPublicUrl.js";
import { mediaKind } from "./mediaKind.js";
import { defaultVariantKeyStrategy } from "./variantKey.js";
import { resizeImage } from "./image/resize.js";
import { transcodeVideo, type TranscodeSource } from "./video/transcode.js";

export type TransformSource =
  | { kind: "buffer"; data: Uint8Array }
  | { kind: "tempFile"; tempFilePath: string; cleanupDir: string };

export type RunTransformPipelineInput = {
  s3: S3Client;
  bucket: string;
  originalKey: string;
  contentType?: string;
  source: TransformSource;
  transforms: Transform[];
  publicBaseUrl?: string;
  variantKeyStrategy?: (input: VariantKeyStrategyInput) => string;
  transformErrorMode?: "fail" | "skip";
};

async function readStreamToBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes?: number
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array);
    total += buf.length;
    if (maxBytes !== undefined && total > maxBytes) {
      throw new ValidationError(`File exceeds maxBytes (${total} > ${maxBytes}).`);
    }
    chunks.push(buf);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function resolveTransformSourceFromR2(params: {
  s3: S3Client;
  bucket: string;
  key: string;
  contentType?: string;
  maxBytes?: number;
}): Promise<TransformSource> {
  const res = await params.s3.send(
    new GetObjectCommand({ Bucket: params.bucket, Key: params.key })
  );
  if (!res.Body) {
    throw new TransformError(`Failed to read object for transforms: ${params.key}`);
  }

  const kind = mediaKind(params.contentType);
  if (kind === "video") {
    const dir = await mkdtemp(join(tmpdir(), `filecel-src-${randomUUID()}-`));
    const ext = params.contentType?.includes("webm") ? ".webm" : ".mp4";
    const tempFilePath = join(dir, `source${ext}`);
    const data = await readStreamToBuffer(res.Body as NodeJS.ReadableStream, params.maxBytes);
    await writeFile(tempFilePath, data);
    return { kind: "tempFile", tempFilePath, cleanupDir: dir };
  }

  const data = await readStreamToBuffer(res.Body as NodeJS.ReadableStream, params.maxBytes);
  return { kind: "buffer", data };
}

function toTranscodeSource(source: TransformSource): TranscodeSource {
  if (source.kind === "buffer") return source.data;
  return { tempFilePath: source.tempFilePath };
}

function validateTransform(transform: Transform, contentType?: string): void {
  const kind = mediaKind(contentType);
  if (transform.type === "resize") {
    if (kind !== "image") {
      throw new TransformError(
        `Resize transform requires an image content type (got ${contentType ?? "unknown"}).`,
        { transform }
      );
    }
    if (transform.width === undefined && transform.height === undefined) {
      throw new TransformError("Resize transform requires at least width or height.", { transform });
    }
  } else if (transform.type === "transcode") {
    if (kind !== "video") {
      throw new TransformError(
        `Transcode transform requires a video content type (got ${contentType ?? "unknown"}).`,
        { transform }
      );
    }
  }
}

async function executeTransform(
  source: TransformSource,
  transform: Transform,
  contentType?: string
): Promise<{ data: Uint8Array; contentType: string }> {
  if (transform.type === "resize") {
    if (source.kind !== "buffer") {
      throw new TransformError("Image resize requires in-memory source.", { transform });
    }
    return resizeImage(source.data, transform);
  }
  return transcodeVideo(toTranscodeSource(source), transform, contentType);
}

async function cleanupSource(source: TransformSource): Promise<void> {
  if (source.kind === "tempFile") {
    await rm(source.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runTransformPipeline(
  input: RunTransformPipelineInput
): Promise<TransformVariantResult[]> {
  const {
    s3,
    bucket,
    originalKey,
    contentType,
    source,
    transforms,
    publicBaseUrl,
    variantKeyStrategy = defaultVariantKeyStrategy,
    transformErrorMode = "fail"
  } = input;

  const results: TransformVariantResult[] = [];

  try {
    for (let index = 0; index < transforms.length; index++) {
      const transform = transforms[index]!;
      try {
        validateTransform(transform, contentType);
        const variantKey = variantKeyStrategy({ originalKey, transform, index });
        const output = await executeTransform(source, transform, contentType);

        const putRes = await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: variantKey,
            Body: output.data,
            ContentType: output.contentType
          })
        );

        results.push({
          key: variantKey,
          transform,
          etag: putRes.ETag,
          size: output.data.byteLength,
          contentType: output.contentType,
          publicUrl: publicBaseUrl
            ? getPublicUrl({ publicBaseUrl, key: variantKey })
            : undefined
        });
      } catch (err) {
        if (transformErrorMode === "skip") continue;
        if (err instanceof TransformError) throw err;
        throw new TransformError("Transform failed.", { transform, cause: err });
      }
    }
  } finally {
    await cleanupSource(source);
  }

  return results;
}

export function bufferTransformSource(data: Uint8Array): TransformSource {
  return { kind: "buffer", data };
}
