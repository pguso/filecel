import { describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import {
  getGenerationById,
  markGenerationCompleted,
  markGenerationFailed,
  markGenerationProcessing
} from "../src/supabase/generations.js";
import { getAssetsByGenerationId, insertAsset } from "../src/supabase/assets.js";

const config = {
  supabase: {
    generationsTable: "generations",
    assetsTable: "assets",
    generationStatus: {
      processing: "PROCESSING",
      completed: "COMPLETED",
      failed: "FAILED"
    }
  }
} as WorkerConfig;

function createSupabaseMock(handlers: {
  generations?: Record<string, unknown>;
  assets?: Record<string, unknown>[];
}) {
  const generationRow = handlers.generations ?? null;
  const assetRows = handlers.assets ?? [];

  return {
    from: vi.fn((table: string) => {
      if (table === "generations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: generationRow, error: null }))
            }))
          })),
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn(async () => {
              Object.assign(generationRow ?? {}, payload);
              return { error: null };
            })
          }))
        };
      }

      if (table === "assets") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: assetRows, error: null }))
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: {
                  id: "asset-1",
                  generation_id: payload.generation_id,
                  project_id: payload.project_id,
                  type: payload.type,
                  storage_url: payload.storage_url,
                  filename: payload.filename,
                  file_size_bytes: payload.file_size_bytes
                },
                error: null
              }))
            }))
          }))
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };
}

describe("generations supabase helpers", () => {
  it("loads a generation row", async () => {
    const supabase = createSupabaseMock({
      generations: {
        id: "gen-1",
        user_id: "user-1",
        project_id: "project-1",
        status: "PENDING"
      }
    });

    const generation = await getGenerationById(supabase as never, config, "gen-1");
    expect(generation).toMatchObject({
      id: "gen-1",
      userId: "user-1",
      projectId: "project-1",
      status: "PENDING"
    });
  });

  it("marks generation processing", async () => {
    const row = {
      id: "gen-1",
      user_id: "user-1",
      project_id: "project-1",
      status: "PENDING"
    };
    const supabase = createSupabaseMock({ generations: row });

    await markGenerationProcessing(supabase as never, config, "gen-1");
    expect(row.status).toBe("PROCESSING");
    expect(row).toHaveProperty("error_message", null);
  });

  it("marks generation completed", async () => {
    const row = {
      id: "gen-1",
      user_id: "user-1",
      project_id: "project-1",
      status: "PROCESSING"
    };
    const supabase = createSupabaseMock({ generations: row });

    await markGenerationCompleted(supabase as never, config, "gen-1", {
      outputUrl: "https://cdn.example.com/file.png",
      completedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(row).toMatchObject({
      status: "COMPLETED",
      output_url: "https://cdn.example.com/file.png",
      completed_at: "2026-01-01T00:00:00.000Z",
      error_message: null
    });
  });

  it("marks generation failed", async () => {
    const row = {
      id: "gen-1",
      user_id: "user-1",
      project_id: "project-1",
      status: "PROCESSING"
    };
    const supabase = createSupabaseMock({ generations: row });

    await markGenerationFailed(supabase as never, config, "gen-1", "upload failed");
    expect(row).toMatchObject({
      status: "FAILED",
      error_message: "upload failed"
    });
  });
});

describe("assets supabase helpers", () => {
  it("loads assets by generation id", async () => {
    const supabase = createSupabaseMock({
      assets: [
        {
          id: "asset-1",
          generation_id: "gen-1",
          project_id: "project-1",
          type: "IMAGE",
          storage_url: "https://cdn.example.com/file.png",
          file_size_bytes: 1234
        }
      ]
    });

    const assets = await getAssetsByGenerationId(supabase as never, config, "gen-1");
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: "asset-1",
      generationId: "gen-1",
      storageUrl: "https://cdn.example.com/file.png",
      fileSizeBytes: 1234
    });
  });

  it("inserts an asset row", async () => {
    const supabase = createSupabaseMock({ assets: [] });

    const asset = await insertAsset(supabase as never, config, {
      generationId: "gen-1",
      projectId: "project-1",
      type: "IMAGE",
      storageUrl: "https://cdn.example.com/file.png",
      filename: "file.png",
      fileSizeBytes: 4567
    });

    expect(asset).toMatchObject({
      id: "asset-1",
      generationId: "gen-1",
      projectId: "project-1",
      type: "IMAGE",
      storageUrl: "https://cdn.example.com/file.png",
      filename: "file.png",
      fileSizeBytes: 4567
    });
  });
});
