import { describe, expect, it, vi, beforeEach } from "vitest";

import type { WorkerConfig } from "../src/config.js";
import { notifyPersistWebhook } from "../src/frameuniverse/webhook.js";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

const config: WorkerConfig = {
  port: 3000,
  apiSecret: "test-secret",
  redisUrl: "redis://localhost",
  queueName: "persist-media",
  workerConcurrency: 1,
  jobAttempts: 3,
  r2: {
    accountId: "acct",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket"
  },
  frameuniverse: {
    apiUrl: "https://frameuniverse.example.com",
    webhookSecret: "webhook-secret"
  }
};

describe("notifyPersistWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => ""
    });
  });

  it("POSTs success payload to the Frameuniverse webhook", async () => {
    await notifyPersistWebhook(config, {
      generationId: "gen-1",
      projectId: "proj-1",
      userId: "user-1",
      key: "users/user-1/images/gen-1",
      kind: "images",
      filename: "output.png",
      mimeType: "image/png",
      fileSizeBytes: 1234
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://frameuniverse.example.com/webhooks/filecel",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer webhook-secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          generationId: "gen-1",
          projectId: "proj-1",
          userId: "user-1",
          key: "users/user-1/images/gen-1",
          kind: "images",
          filename: "output.png",
          mimeType: "image/png",
          fileSizeBytes: 1234
        })
      })
    );
  });

  it("POSTs failure payload with generationId and error", async () => {
    await notifyPersistWebhook(config, {
      generationId: "gen-1",
      error: "upload failed"
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://frameuniverse.example.com/webhooks/filecel",
      expect.objectContaining({
        body: JSON.stringify({
          generationId: "gen-1",
          error: "upload failed"
        })
      })
    );
  });

  it("strips trailing slash from api URL", async () => {
    await notifyPersistWebhook(
      { ...config, frameuniverse: { ...config.frameuniverse, apiUrl: "https://frameuniverse.example.com/" } },
      { generationId: "gen-1", error: "failed" }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://frameuniverse.example.com/webhooks/filecel",
      expect.any(Object)
    );
  });

  it("throws when webhook returns non-2xx", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error"
    });

    await expect(
      notifyPersistWebhook(config, { generationId: "gen-1", error: "upload failed" })
    ).rejects.toThrow("Frameuniverse webhook failed (500): internal error");
  });
});
