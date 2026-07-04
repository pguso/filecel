import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkerConfig } from "../config.js";

export type GenerationRecord = {
  id: string;
  userId: string;
  projectId: string;
  status: string;
  outputUrl?: string;
  errorMessage?: string;
  completedAt?: string;
};

function rowToGeneration(row: Record<string, unknown>): GenerationRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    status: String(row.status),
    outputUrl: row.output_url != null ? String(row.output_url) : undefined,
    errorMessage: row.error_message != null ? String(row.error_message) : undefined,
    completedAt: row.completed_at != null ? String(row.completed_at) : undefined
  };
}

export async function getGenerationById(
  supabase: SupabaseClient,
  config: WorkerConfig,
  generationId: string
): Promise<GenerationRecord | null> {
  const { data, error } = await supabase
    .from(config.supabase.generationsTable)
    .select("*")
    .eq("id", generationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load generation ${generationId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return rowToGeneration(data as Record<string, unknown>);
}

export function validateGenerationOwnership(
  generation: GenerationRecord,
  userId: string,
  projectId: string
): void {
  if (generation.userId !== userId) {
    throw new Error(`Generation ${generation.id} does not belong to user ${userId}`);
  }

  if (generation.projectId !== projectId) {
    throw new Error(`Generation ${generation.id} does not belong to project ${projectId}`);
  }
}

export async function markGenerationProcessing(
  supabase: SupabaseClient,
  config: WorkerConfig,
  generationId: string
): Promise<void> {
  const { error } = await supabase
    .from(config.supabase.generationsTable)
    .update({
      status: config.supabase.generationStatus.processing,
      error_message: null
    })
    .eq("id", generationId);

  if (error) {
    throw new Error(`Failed to mark generation ${generationId} as processing: ${error.message}`);
  }
}

export async function markGenerationCompleted(
  supabase: SupabaseClient,
  config: WorkerConfig,
  generationId: string,
  update: { outputUrl: string; completedAt?: string }
): Promise<void> {
  const { error } = await supabase
    .from(config.supabase.generationsTable)
    .update({
      status: config.supabase.generationStatus.completed,
      output_url: update.outputUrl,
      completed_at: update.completedAt ?? new Date().toISOString(),
      error_message: null
    })
    .eq("id", generationId);

  if (error) {
    throw new Error(`Failed to mark generation ${generationId} as completed: ${error.message}`);
  }
}

export async function markGenerationFailed(
  supabase: SupabaseClient,
  config: WorkerConfig,
  generationId: string,
  message: string
): Promise<void> {
  const { error } = await supabase
    .from(config.supabase.generationsTable)
    .update({
      status: config.supabase.generationStatus.failed,
      error_message: message
    })
    .eq("id", generationId);

  if (error) {
    throw new Error(`Failed to mark generation ${generationId} as failed: ${error.message}`);
  }
}
