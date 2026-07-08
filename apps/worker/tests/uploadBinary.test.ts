import { ValidationError } from "@filecel/r2";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUploadBuffer = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockCreateKey = vi.fn();

vi.mock("@filecel/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@filecel/r2")>();
  return {
    ...actual,
    createKey: (...args: unknown[]) => mockCreateKey(...args),
    createR2Client: vi.fn(() => ({
      uploadBuffer: mockUploadBuffer,
      getPublicUrl: mockGetPublicUrl
    }))
  };
});

import { handleUploadBinary } from "../src/routes/jobs.js";
import type { WorkerConfig } from "../src/config.js";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
    bucket: "bucket",
    publicBaseUrl: "https://media.example.com"
  },
  supabase: {
    url: "https://example.supabase.co",
    serviceRoleKey: "service-key",
    generationsTable: "generations",
    assetsTable: "assets",
    generationStatus: {
      processing: "PROCESSING",
      completed: "COMPLETED",
      failed: "FAILED"
    }
  }
};

function jsonRequest(body: unknown, auth?: string): IncomingMessage {
  const payload = JSON.stringify(body);
  return {
    headers: { authorization: auth },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    }
  } as unknown as IncomingMessage;
}

function captureResponse(): {
  res: ServerResponse;
  getStatus: () => number;
  getBody: () => unknown;
} {
  let status = 0;
  let body: unknown;

  const res = {
    writeHead: vi.fn((s: number) => {
      status = s;
    }),
    end: vi.fn((payload: string) => {
      body = JSON.parse(payload);
    })
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => status,
    getBody: () => body
  };
}

describe("handleUploadBinary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateKey.mockReturnValue("users/u1/images/abc.jpg");
    mockUploadBuffer.mockResolvedValue({
      key: "users/u1/images/abc.jpg",
      publicUrl: "https://media.example.com/users/u1/images/abc.jpg"
    });
    mockGetPublicUrl.mockReturnValue("https://media.example.com/users/u1/images/abc.jpg");
  });

  it("returns 401 without bearer auth", async () => {
    const { res, getStatus, getBody } = captureResponse();

    await handleUploadBinary(
      jsonRequest({ userId: "u1", fileName: "a.jpg", mimeType: "image/jpeg", base64: PNG_B64 }),
      res,
      config
    );

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: "Unauthorized" });
    expect(mockUploadBuffer).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const { res, getStatus, getBody } = captureResponse();

    await handleUploadBinary(
      jsonRequest({ fileName: "a.jpg", mimeType: "image/jpeg", base64: PNG_B64 }, "Bearer test-secret"),
      res,
      config
    );

    expect(getStatus()).toBe(400);
    expect(getBody()).toEqual({ error: "userId is required" });
  });

  it("returns 400 for disallowed mimeType", async () => {
    const { res, getStatus, getBody } = captureResponse();

    await handleUploadBinary(
      jsonRequest(
        { userId: "u1", fileName: "a.gif", mimeType: "image/gif", base64: PNG_B64 },
        "Bearer test-secret"
      ),
      res,
      config
    );

    expect(getStatus()).toBe(400);
    expect(getBody()).toEqual({
      error: "mimeType must be one of: image/jpeg, image/png, image/webp"
    });
  });

  it("returns 400 when decoded payload exceeds 4MB", async () => {
    const { res, getStatus, getBody } = captureResponse();
    const oversized = Buffer.alloc(4 * 1024 * 1024 + 1, 0xff).toString("base64");

    await handleUploadBinary(
      jsonRequest(
        { userId: "u1", fileName: "big.jpg", mimeType: "image/jpeg", base64: oversized },
        "Bearer test-secret"
      ),
      res,
      config
    );

    expect(getStatus()).toBe(400);
    expect(getBody()).toEqual({ error: "File exceeds maximum size of 4194304 bytes" });
    expect(mockUploadBuffer).not.toHaveBeenCalled();
  });

  it("returns 201 with storageUrl and key on success", async () => {
    const { res, getStatus, getBody } = captureResponse();

    await handleUploadBinary(
      jsonRequest(
        {
          userId: "u1",
          fileName: "image.jpg",
          mimeType: "image/jpeg",
          base64: PNG_B64,
          kind: "images"
        },
        "Bearer test-secret"
      ),
      res,
      config
    );

    expect(getStatus()).toBe(201);
    expect(getBody()).toEqual({
      storageUrl: "https://media.example.com/users/u1/images/abc.jpg",
      key: "users/u1/images/abc.jpg"
    });

    expect(mockCreateKey).toHaveBeenCalledWith({
      userId: "u1",
      kind: "images",
      ext: "jpg"
    });

    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        key: "users/u1/images/abc.jpg",
        contentType: "image/jpeg",
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
        maxBytes: 4 * 1024 * 1024,
        metadata: { userId: "u1", source: "upload-binary" }
      })
    );
  });

  it("maps ValidationError from r2 to 400", async () => {
    mockUploadBuffer.mockRejectedValue(new ValidationError("MIME type not allowed"));

    const { res, getStatus, getBody } = captureResponse();

    await handleUploadBinary(
      jsonRequest(
        { userId: "u1", fileName: "image.jpg", mimeType: "image/jpeg", base64: PNG_B64 },
        "Bearer test-secret"
      ),
      res,
      config
    );

    expect(getStatus()).toBe(400);
    expect(getBody()).toEqual({ error: "MIME type not allowed" });
  });
});
