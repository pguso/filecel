import type { KeyKind } from "@filecel/r2";
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

const VALID_KINDS = new Set<KeyKind>(["images", "videos", "files"]);

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
