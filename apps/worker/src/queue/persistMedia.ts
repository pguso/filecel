import { createKey, createR2Client } from "@filecel/r2";
import { Queue, Worker, type JobsOptions, type Queue as BullQueue } from "bullmq";

import type { WorkerConfig } from "../config.js";
import { notifyPersistWebhook } from "../frameuniverse/webhook.js";
import {
  createRedisConnectionOptions,
  deriveFilename,
  persistMediaJobId,
  type PersistMediaJobData
} from "./types.js";

export type PersistMediaQueue = BullQueue<PersistMediaJobData>;

export function createPersistMediaQueue(config: WorkerConfig): PersistMediaQueue {
  return new Queue<PersistMediaJobData>(config.queueName, {
    connection: createRedisConnectionOptions(config),
    defaultJobOptions: {
      attempts: config.jobAttempts,
      backoff: {
        type: "exponential",
        delay: 5_000
      },
      removeOnComplete: 1_000,
      removeOnFail: 5_000
    }
  });
}

export function startPersistMediaWorker(config: WorkerConfig): Worker<PersistMediaJobData> {
  const r2 = createR2Client({
    accountId: config.r2.accountId,
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
    bucket: config.r2.bucket
  });

  return new Worker<PersistMediaJobData>(
    config.queueName,
    async (job) => {
      const {
        userId,
        generationId,
        projectId,
        sourceUrl,
        kind = "files",
        filename,
        metadata
      } = job.data;

      const key = createKey({ userId, kind, uuid: generationId });
      const result = await r2.uploadFromUrl(sourceUrl, {
        key,
        metadata: {
          userId,
          generationId,
          projectId,
          source: "replicate",
          ...metadata
        }
      });

      const resolvedFilename = deriveFilename(sourceUrl, result.key, filename);

      await notifyPersistWebhook(config, {
        generationId,
        projectId,
        userId,
        key: result.key,
        kind,
        filename: resolvedFilename,
        mimeType: result.contentType,
        fileSizeBytes: result.size,
        metadata
      });

      return {
        key: result.key,
        fileSizeBytes: result.size
      };
    },
    {
      connection: createRedisConnectionOptions(config),
      concurrency: config.workerConcurrency
    }
  ).on("failed", async (job, error) => {
    if (!job) {
      return;
    }

    const attempts = job.opts.attempts ?? config.jobAttempts;
    const isFinalAttempt = job.attemptsMade >= attempts;

    if (isFinalAttempt) {
      await notifyPersistWebhook(config, {
        generationId: job.data.generationId,
        error: error.message
      }).catch((webhookError) => {
        console.error("Failed to notify Frameuniverse of persist failure:", webhookError);
      });
    }
  });
}

export async function enqueuePersistMediaJob(
  queue: PersistMediaQueue,
  data: PersistMediaJobData,
  options?: JobsOptions
) {
  const jobId = persistMediaJobId(data);
  const existing = await queue.getJob(jobId);

  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "active" || state === "waiting" || state === "delayed") {
      return { jobId, status: "queued" as const, duplicate: true };
    }

    await existing.remove();
  }

  await queue.add("persist-media", data, {
    ...options,
    jobId
  });

  return { jobId, status: "queued" as const, duplicate: false };
}
