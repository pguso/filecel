import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { fileTypeFromBuffer } from "file-type";

import type {
  DefaultKeyStrategyInput,
  Metadata,
  UploadFromUrlOptions,
  UploadFromUrlResult
} from "../types.js";
import { FetchError, UploadError, ValidationError } from "../errors.js";
import { withRetry } from "../retry/withRetry.js";
import { getPublicUrl } from "../urls/getPublicUrl.js";

function stripCharset(contentType: string): string {
  return contentType.split(";")[0]?.trim() ?? contentType.trim();
}

function isRetryableFetchStatus(status: number): boolean {
  if (status === 408) return true;
  if (status === 409) return true;
  if (status === 425) return true;
  if (status === 429) return true;
  return status >= 500 && status <= 599;
}

function parseContentLength(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function defaultKeyStrategy(input: DefaultKeyStrategyInput): string {
  const base = input.idempotencyKey ?? crypto.randomUUID();
  const ext = input.ext ? input.ext.replace(/^\./, "") : undefined;
  const filename = ext ? `${base}.${ext}` : base;
  return `uploads/${filename}`;
}

async function fetchWithTimeout(params: {
  url: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  fetchInit?: Omit<RequestInit, "signal">;
}): Promise<Response> {
  const { url, timeoutMs, signal, fetchFn, fetchInit } = params;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const t =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    return await fetchFn(url, {
      redirect: "follow",
      ...(fetchInit ?? {}),
      signal: controller.signal
    });
  } finally {
    if (t) clearTimeout(t);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function readIntoBufferWithLimit(res: Response, maxBytes?: number): Promise<Uint8Array> {
  const ab = await res.arrayBuffer();
  const u8 = new Uint8Array(ab);
  if (maxBytes !== undefined && u8.byteLength > maxBytes) {
    throw new ValidationError(`File exceeds maxBytes (${u8.byteLength} > ${maxBytes}).`);
  }
  return u8;
}

async function sniffStreamAndReplay(params: {
  stream: ReadableStream<Uint8Array>;
  sniffBytes: number;
}): Promise<{ replayStream: ReadableStream<Uint8Array>; head: Uint8Array }> {
  const reader = params.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < params.sniffBytes) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  const head = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    head.set(c, offset);
    offset += c.byteLength;
  }

  const replayStream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            if (!value) continue;
            controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
        }
      };
      void pump();
    }
  });

  return { replayStream, head };
}

function countBytesAndAbortStream(params: {
  stream: ReadableStream<Uint8Array>;
  maxBytes?: number;
  onProgress?: (total: number) => void;
}): ReadableStream<Uint8Array> {
  const { stream, maxBytes, onProgress } = params;
  if (maxBytes === undefined) return stream;
  let total = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = stream.getReader();
      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            if (!value) continue;
            total += value.byteLength;
            onProgress?.(total);
            if (total > maxBytes) {
              controller.error(new ValidationError(`File exceeds maxBytes (${total} > ${maxBytes}).`));
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              return;
            }
            controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
        }
      };
      void pump();
    }
  });
}

export async function uploadFromUrl(params: {
  s3: S3Client;
  bucket: string;
  url: string;
  options?: UploadFromUrlOptions;
  publicBaseUrl?: string;
  defaultKeyStrategy?: (input: DefaultKeyStrategyInput) => string;
  fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<UploadFromUrlResult> {
  const { s3, bucket, url } = params;
  const options = params.options ?? {};

  const overallController = new AbortController();
  const overallTimeout =
    options.overallTimeoutMs && options.overallTimeoutMs > 0
      ? setTimeout(() => overallController.abort(), options.overallTimeoutMs)
      : undefined;

  try {
    const fetchMaxAttempts = options.fetchMaxAttempts ?? 3;

    const res = await withRetry(
      async () => {
        const fetchFn = params.fetchFn ?? globalThis.fetch;
        const r = await fetchWithTimeout({
          url,
          timeoutMs: options.fetchTimeoutMs,
          signal: overallController.signal,
          fetchFn,
          fetchInit: options.fetchInit
        });
        if (!r.ok) {
          if (isRetryableFetchStatus(r.status)) {
            throw new FetchError(`Retryable fetch status ${r.status}.`, { url, status: r.status });
          }
          throw new FetchError(`Fetch failed with status ${r.status}.`, { url, status: r.status });
        }
        return r;
      },
      {
        maxAttempts: fetchMaxAttempts,
        retryOn: (err) => {
          const anyErr = err as { name?: string; status?: number };
          if (anyErr?.name === "AbortError") return false;
          if (err instanceof FetchError && anyErr?.status !== undefined) {
            return isRetryableFetchStatus(anyErr.status);
          }
          // network errors are retryable by default
          return true;
        }
      }
    );

    const headerContentType = res.headers.get("content-type");
    const contentTypeFromHeader = headerContentType ? stripCharset(headerContentType) : undefined;
    const contentLength = parseContentLength(res.headers.get("content-length"));

    if (options.maxBytes !== undefined && contentLength !== undefined && contentLength > options.maxBytes) {
      throw new ValidationError(`File exceeds maxBytes (${contentLength} > ${options.maxBytes}).`);
    }

    const bufferThresholdBytes = options.bufferThresholdBytes ?? 8 * 1024 * 1024;
    const useBuffer = contentLength !== undefined && contentLength <= bufferThresholdBytes;

    let bodyForUpload: Uint8Array | ReadableStream<Uint8Array> | NodeJS.ReadableStream;
    let detectedContentType: string | undefined = contentTypeFromHeader;
    let detectedExt: string | undefined;
    let size: number | undefined = contentLength;

    if (useBuffer) {
      const u8 = await readIntoBufferWithLimit(res, options.maxBytes);
      size = u8.byteLength;

      if (!detectedContentType) {
        const ft = await fileTypeFromBuffer(u8);
        detectedContentType = ft?.mime;
        detectedExt = ft?.ext;
      }
      bodyForUpload = u8;
    } else {
      if (!res.body) {
        throw new FetchError("Fetch response had no body.", { url, status: res.status });
      }
      const stream = res.body as unknown as ReadableStream<Uint8Array>;
      const { replayStream, head } = await sniffStreamAndReplay({ stream, sniffBytes: 4100 });
      if (!detectedContentType) {
        const ft = await fileTypeFromBuffer(head);
        detectedContentType = ft?.mime;
        detectedExt = ft?.ext;
      }
      let streamedBytes: number | undefined;
      bodyForUpload = countBytesAndAbortStream({
        stream: replayStream,
        maxBytes: options.maxBytes,
        onProgress: (n) => {
          streamedBytes = n;
        }
      });
      if (size === undefined) size = streamedBytes;
    }

    if (options.allowedMimeTypes?.length) {
      const ct = detectedContentType;
      if (!ct || !options.allowedMimeTypes.includes(ct)) {
        throw new ValidationError(
          `MIME type not allowed (${ct ?? "unknown"}). Allowed: ${options.allowedMimeTypes.join(", ")}`
        );
      }
    }

    const key =
      options.key ??
      (params.defaultKeyStrategy ?? defaultKeyStrategy)({
        url,
        contentType: detectedContentType,
        ext: detectedExt,
        idempotencyKey: options.idempotencyKey
      });

    const metadata: Metadata | undefined = options.metadata;

    try {
      if (useBuffer) {
        const putRes = await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bodyForUpload as Uint8Array,
            ContentType: detectedContentType,
            Metadata: metadata
          })
        );
        const publicUrl = params.publicBaseUrl
          ? getPublicUrl({ publicBaseUrl: params.publicBaseUrl, key })
          : undefined;
        return {
          key,
          etag: putRes.ETag,
          size,
          contentType: detectedContentType,
          publicUrl
        };
      }

      const uploader = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: key,
          // @aws-sdk/lib-storage accepts stream/Uint8Array; types are permissive.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Body: bodyForUpload as any,
          ContentType: detectedContentType,
          Metadata: metadata
        }
      });

      const uploadMaxAttempts = options.uploadMaxAttempts ?? 2;
      const uploadRes = await withRetry(() => uploader.done(), {
        maxAttempts: uploadMaxAttempts,
        retryOn: (err) => {
          const anyErr = err as { name?: string };
          if (anyErr?.name === "AbortError") return false;
          return true;
        }
      });

      const publicUrl = params.publicBaseUrl
        ? getPublicUrl({ publicBaseUrl: params.publicBaseUrl, key })
        : undefined;

      return {
        key,
        etag: uploadRes?.ETag as string | undefined,
        size,
        contentType: detectedContentType,
        publicUrl
      };
    } catch (err) {
      throw new UploadError("Upload to R2 failed.", { key, cause: err });
    }
  } finally {
    if (overallTimeout) clearTimeout(overallTimeout);
  }
}

