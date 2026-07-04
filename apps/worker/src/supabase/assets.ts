import type { KeyKind } from "@filecel/r2";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkerConfig } from "../config.js";

export type AssetType = "IMAGE" | "VIDEO";

export type AssetRecord = {
  id: string;
  generationId: string;
  projectId: string;
  type: AssetType;
  storageUrl: string;
  filename?: string;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type AssetInsert = {
  generationId: string;
  projectId: string;
  type: AssetType;
  storageUrl: string;
  filename?: string;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

function rowToAsset(row: Record<string, unknown>): AssetRecord {
  return {
    id: String(row.id),
    generationId: String(row.generation_id),
    projectId: String(row.project_id),
    type: row.type as AssetType,
    storageUrl: String(row.storage_url),
    filename: row.filename != null ? String(row.filename) : undefined,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : undefined,
    width: row.width != null ? Number(row.width) : undefined,
    height: row.height != null ? Number(row.height) : undefined,
    durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : undefined
  };
}

export function assetTypeFromKind(kind: KeyKind): AssetType {
  if (kind === "videos") {
    return "VIDEO";
  }

  return "IMAGE";
}

export async function getAssetsByGenerationId(
  supabase: SupabaseClient,
  config: WorkerConfig,
  generationId: string
): Promise<AssetRecord[]> {
  const { data, error } = await supabase
    .from(config.supabase.assetsTable)
    .select("*")
    .eq("generation_id", generationId);

  if (error) {
    throw new Error(`Failed to load assets for generation ${generationId}: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToAsset(row as Record<string, unknown>));
}

export async function insertAsset(
  supabase: SupabaseClient,
  config: WorkerConfig,
  asset: AssetInsert
): Promise<AssetRecord> {
  const { data, error } = await supabase
    .from(config.supabase.assetsTable)
    .insert({
      generation_id: asset.generationId,
      project_id: asset.projectId,
      type: asset.type,
      storage_url: asset.storageUrl,
      ...(asset.filename != null ? { filename: asset.filename } : {}),
      ...(asset.fileSizeBytes != null ? { file_size_bytes: asset.fileSizeBytes } : {}),
      ...(asset.width != null ? { width: asset.width } : {}),
      ...(asset.height != null ? { height: asset.height } : {}),
      ...(asset.durationSeconds != null ? { duration_seconds: asset.durationSeconds } : {})
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to insert asset for generation ${asset.generationId}: ${error.message}`);
  }

  return rowToAsset(data as Record<string, unknown>);
}
