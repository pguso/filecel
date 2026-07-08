import { createKey, createR2Client, ValidationError, type KeyKind } from "@filecel/r2";
import { extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { verifyBearerAuth } from "../auth.js";
import type { WorkerConfig } from "../config.js";
import { badRequest, readJsonBody, sendJson, unauthorized } from "../http/respond.js";
import { enqueuePersistMediaJob, type PersistMediaQueue } from "../queue/persistMedia.js";

type PersistMediaRequest = {
  userId?: string;
  generationId?: string;
  projectId?: string;
  sourceUrl?: string;
  kind?: KeyKind;
  filename?: string;
  metadata?: Record<string, string>;
};

type UploadBinaryRequest = {
  userId?: string;
  fileName?: string;
  mimeType?: string;
  base64?: string;
  kind?: KeyKind;
};

const VALID_KINDS = new Set<KeyKind>(["images", "videos", "files"]);
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function handlePersistMediaJob(
  req: IncomingMessage,
  res: ServerResponse,
  config: WorkerConfig,
  queue: PersistMediaQueue
): Promise<void> {
  if (!verifyBearerAuth(req.headers.authorization, config.apiSecret)) {
    unauthorized(res);
    return;
  }

  let body: PersistMediaRequest;
  try {
    body = await readJsonBody<PersistMediaRequest>(req);
  } catch (error) {
    badRequest(res, error instanceof Error ? error.message : "Invalid JSON body");
    return;
  }

  const { userId, generationId, projectId, sourceUrl, kind, filename, metadata } = body;

  if (!userId || !generationId || !projectId || !sourceUrl) {
    badRequest(res, "userId, generationId, projectId, and sourceUrl are required");
    return;
  }

  if (!isValidHttpUrl(sourceUrl)) {
    badRequest(res, "sourceUrl must be a valid http(s) URL");
    return;
  }

  if (kind && !VALID_KINDS.has(kind)) {
    badRequest(res, "kind must be one of: images, videos, files");
    return;
  }

  const result = await enqueuePersistMediaJob(queue, {
    userId,
    generationId,
    projectId,
    sourceUrl,
    kind,
    filename,
    metadata
  });

  sendJson(res, 202, result);
}

export async function handleUploadBinary(
  req: IncomingMessage,
  res: ServerResponse,
  config: WorkerConfig
): Promise<void> {
  if (!verifyBearerAuth(req.headers.authorization, config.apiSecret)) {
    unauthorized(res);
    return;
  }

  let body: UploadBinaryRequest;
  try {
    body = await readJsonBody<UploadBinaryRequest>(req);
  } catch (error) {
    badRequest(res, error instanceof Error ? error.message : "Invalid JSON body");
    return;
  }

  const { userId, fileName, mimeType, base64, kind } = body;

  if (!userId?.trim()) {
    badRequest(res, "userId is required");
    return;
  }

  if (!fileName?.trim()) {
    badRequest(res, "fileName is required");
    return;
  }

  if (!mimeType?.trim()) {
    badRequest(res, "mimeType is required");
    return;
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
    badRequest(res, `mimeType must be one of: ${ALLOWED_MIME_TYPES.join(", ")}`);
    return;
  }

  if (!base64?.trim()) {
    badRequest(res, "base64 is required");
    return;
  }

  if (kind && !VALID_KINDS.has(kind)) {
    badRequest(res, "kind must be one of: images, videos, files");
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    badRequest(res, "base64 must be valid base64");
    return;
  }

  if (buffer.byteLength === 0) {
    badRequest(res, "base64 must decode to non-empty content");
    return;
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    badRequest(res, `File exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`);
    return;
  }

  const resolvedKind = kind ?? "images";
  const ext = extname(fileName).replace(/^\./, "") || undefined;
  const key = createKey({ userId, kind: resolvedKind, ext });

  const r2 = createR2Client({
    accountId: config.r2.accountId,
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
    bucket: config.r2.bucket,
    publicBaseUrl: config.r2.publicBaseUrl
  });

  try {
    const result = await r2.uploadBuffer(buffer, {
      key,
      contentType: mimeType,
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      maxBytes: MAX_UPLOAD_BYTES,
      metadata: { userId, source: "upload-binary" }
    });

    const storageUrl = result.publicUrl ?? r2.getPublicUrl(result.key);
    sendJson(res, 201, { storageUrl, key: result.key });
  } catch (error) {
    if (error instanceof ValidationError) {
      badRequest(res, error.message);
      return;
    }

    console.error("upload-binary failed:", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
}
