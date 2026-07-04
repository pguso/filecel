import { createKey, createR2Client } from "@filecel/r2";
import { Queue, Worker, type JobsOptions, type Queue as BullQueue } from "bullmq";

import type { WorkerConfig } from "../config.js";
import { createSupabaseAdmin } from "../supabase/client.js";
import { assetTypeFromKind, getAssetsByGenerationId, insertAsset } from "../supabase/assets.js";
import {
  getGenerationById,
  markGenerationCompleted,
  markGenerationFailed,
  markGenerationProcessing,
  validateGenerationOwnership
} from "../supabase/generations.js";
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

async function finalizeGeneration(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  config: WorkerConfig,
  generationId: string,
  storageUrl: string
) {
  await markGenerationCompleted(supabase, config, generationId, {
    outputUrl: storageUrl
  });
}

export function startPersistMediaWorker(config: WorkerConfig): Worker<PersistMediaJobData> {
  const supabase = createSupabaseAdmin(config);
  const r2 = createR2Client({
    accountId: config.r2.accountId,
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
    bucket: config.r2.bucket,
    publicBaseUrl: config.r2.publicBaseUrl
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

      const generation = await getGenerationById(supabase, config, generationId);
      if (!generation) {
        throw new Error(`Generation not found: ${generationId}`);
      }

      validateGenerationOwnership(generation, userId, projectId);

      const existingAssets = await getAssetsByGenerationId(supabase, config, generationId);
      const completedStatus = config.supabase.generationStatus.completed;
      const processingStatus = config.supabase.generationStatus.processing;

      if (
        generation.status === completedStatus &&
        existingAssets.length > 0
      ) {
        const asset = existingAssets[0]!;
        return {
          skipped: true,
          assetId: asset.id,
          storageUrl: asset.storageUrl
        };
      }

      if (
        generation.status === processingStatus &&
        existingAssets.length > 0
      ) {
        const asset = existingAssets[0]!;
        await finalizeGeneration(supabase, config, generationId, asset.storageUrl);
        return {
          recovered: true,
          assetId: asset.id,
          storageUrl: asset.storageUrl
        };
      }

      await markGenerationProcessing(supabase, config, generationId);

      const key = createKey({ userId, kind });
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

      const storageUrl = result.publicUrl ?? r2.getPublicUrl(result.key);
      const asset = await insertAsset(supabase, config, {
        generationId,
        projectId,
        type: assetTypeFromKind(kind),
        storageUrl,
        filename: deriveFilename(sourceUrl, result.key, filename),
        fileSizeBytes: result.size
      });

      await finalizeGeneration(supabase, config, generationId, storageUrl);

      return {
        assetId: asset.id,
        storageUrl,
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
      await markGenerationFailed(supabase, config, job.data.generationId, error.message).catch(
        (markError) => {
          console.error("Failed to mark generation as failed:", markError);
        }
      );
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
