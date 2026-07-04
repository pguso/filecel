import { createHash } from "node:crypto";

import type { KeyKind } from "@filecel/r2";
import type { ConnectionOptions } from "bullmq";

import type { WorkerConfig } from "../config.js";

export type PersistMediaJobData = {
  userId: string;
  generationId: string;
  projectId: string;
  sourceUrl: string;
  kind?: KeyKind;
  filename?: string;
  metadata?: Record<string, string>;
};

export function createRedisConnectionOptions(config: WorkerConfig): ConnectionOptions {
  const url = new URL(config.redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isFinite(db) ? db : undefined,
    maxRetriesPerRequest: null
  };
}

export function persistMediaJobId(data: PersistMediaJobData): string {
  return `persist-media-${data.generationId}`;
}

export function deriveFilename(sourceUrl: string, storageKey: string, filename?: string): string | undefined {
  if (filename) {
    return filename;
  }

  try {
    const pathname = new URL(sourceUrl).pathname;
    const fromUrl = pathname.split("/").pop();
    if (fromUrl) {
      return fromUrl;
    }
  } catch {
    // fall through to storage key
  }

  const fromKey = storageKey.split("/").pop();
  return fromKey || undefined;
}
