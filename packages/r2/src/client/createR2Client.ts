import type { S3Client } from "@aws-sdk/client-s3";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";

import type {
  CopyOptions,
  HeadResult,
  ListResult,
  MoveOptions,
  R2Client,
  R2ClientConfig,
  SignedUrlOptions,
  UploadBufferOptions,
  UploadBufferResult,
  UploadFromUrlOptions,
  UploadFromUrlResult
} from "../types.js";
import { createS3Client } from "./s3.js";
import { signWorkerUrl } from "../signedUrl/workerHmac.js";
import { SigningError } from "../errors.js";
import { uploadBuffer } from "../upload/uploadBuffer.js";
import { uploadFromUrl } from "../upload/uploadFromUrl.js";
import { getPublicUrl } from "../urls/getPublicUrl.js";

export function createR2Client(config: R2ClientConfig): R2Client {
  const s3 = createS3Client(config);
  return createR2ClientFromS3({ config, s3 });
}

export function createR2ClientFromS3(params: { config: R2ClientConfig; s3: S3Client }): R2Client {
  const { config, s3 } = params;
  const bucket = config.bucket;

  const client: R2Client = {
    async uploadFromUrl(url: string, options?: UploadFromUrlOptions): Promise<UploadFromUrlResult> {
      return uploadFromUrl({
        s3,
        bucket,
        url,
        options,
        publicBaseUrl: config.publicBaseUrl,
        defaultKeyStrategy: config.defaultKeyStrategy,
        fetchFn: config.fetch
      });
    },

    async uploadBuffer(buffer: Uint8Array, options?: UploadBufferOptions): Promise<UploadBufferResult> {
      return uploadBuffer({
        s3,
        bucket,
        buffer,
        options,
        publicBaseUrl: config.publicBaseUrl
      });
    },

    async delete(key: string): Promise<void> {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async list(options): Promise<ListResult> {
      const limit = options?.limit;
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: options?.prefix,
          ContinuationToken: options?.cursor,
          MaxKeys: limit
        })
      );

      const items =
        res.Contents?.map((o) => ({
          key: o.Key ?? "",
          size: o.Size,
          etag: o.ETag,
          lastModified: o.LastModified
        })).filter((i) => i.key.length > 0) ?? [];

      return {
        items,
        nextCursor: res.IsTruncated ? res.NextContinuationToken : undefined
      };
    },

    async copy(options: CopyOptions): Promise<void> {
      const copySource = `/${bucket}/${encodeURIComponent(options.fromKey)}`;
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: options.toKey,
          CopySource: copySource,
          MetadataDirective: options.metadataDirective ?? "COPY"
        })
      );
    },

    async move(options: MoveOptions): Promise<void> {
      await client.copy({ fromKey: options.fromKey, toKey: options.toKey });
      await client.delete(options.fromKey);
    },

    async head(key: string): Promise<HeadResult | null> {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          key,
          contentType: res.ContentType,
          contentLength: res.ContentLength,
          etag: res.ETag,
          metadata: res.Metadata as Record<string, string> | undefined,
          lastModified: res.LastModified
        };
      } catch (err) {
        // For not-found, AWS SDK throws; we treat as null.
        const anyErr = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (anyErr?.name === "NotFound" || anyErr?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    getPublicUrl(key: string): string {
      return getPublicUrl({ publicBaseUrl: config.publicBaseUrl, key });
    },

    async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
      const baseUrl = options.baseUrl ?? config.publicBaseUrl;
      if (!baseUrl) {
        throw new SigningError("Missing baseUrl/publicBaseUrl for signed URL generation.");
      }
      return signWorkerUrl({
        baseUrl,
        key,
        expiresIn: options.expiresIn,
        secret: options.secret,
        salt: options.salt,
        queryParams: options.queryParams
      });
    }
  };

  return client;
}

