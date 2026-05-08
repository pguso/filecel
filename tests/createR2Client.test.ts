import { describe, expect, it, vi } from "vitest";

vi.mock("../src/upload/uploadFromUrl.js", () => ({
  uploadFromUrl: vi.fn(async () => ({
    key: "uploaded/key",
    etag: "\"etag\"",
    size: 1,
    contentType: "image/png"
  }))
}));

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";
import { uploadFromUrl as uploadFromUrlFn } from "../src/upload/uploadFromUrl.js";
import { createR2ClientFromS3 } from "../src/client/createR2Client.js";
import type { R2ClientConfig } from "../src/types.js";
import { SigningError } from "../src/errors.js";

function baseConfig(overrides: Partial<R2ClientConfig> = {}): R2ClientConfig {
  return {
    accountId: "acc",
    bucket: "my-bucket",
    accessKeyId: "aki",
    secretAccessKey: "sk",
    publicBaseUrl: "https://cdn.example.com",
    ...overrides
  };
}

function makeClient(s3: { send: ReturnType<typeof vi.fn> }) {
  return createR2ClientFromS3({ config: baseConfig(), s3: s3 as any });
}

function firstCommand(send: ReturnType<typeof vi.fn>): unknown {
  const pair = (send as { mock: { calls: unknown[][] } }).mock.calls[0];
  return pair![0];
}

describe("createR2ClientFromS3", () => {
  it("delete sends DeleteObjectCommand", async () => {
    const send = vi.fn(async () => ({}));
    const client = makeClient({ send });
    await client.delete("a/b.webp");

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = firstCommand(send);
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect((cmd as InstanceType<typeof DeleteObjectCommand>).input).toEqual({
      Bucket: "my-bucket",
      Key: "a/b.webp"
    });
  });

  it("list maps Contents and nextCursor when truncated", async () => {
    const send = vi.fn(async () => ({
      Contents: [{ Key: "x", Size: 10, ETag: "\"e\"", LastModified: new Date("2026-01-01") }],
      IsTruncated: true,
      NextContinuationToken: "tok2"
    }));
    const client = makeClient({ send });
    const res = await client.list({ prefix: "p/", cursor: "tok1", limit: 5 });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = firstCommand(send);
    expect(cmd).toBeInstanceOf(ListObjectsV2Command);
    expect((cmd as InstanceType<typeof ListObjectsV2Command>).input).toEqual({
      Bucket: "my-bucket",
      Prefix: "p/",
      ContinuationToken: "tok1",
      MaxKeys: 5
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.key).toBe("x");
    expect(res.nextCursor).toBe("tok2");
  });

  it("copy sends CopyObjectCommand with encoded CopySource", async () => {
    const send = vi.fn(async () => ({}));
    const client = makeClient({ send });
    await client.copy({ fromKey: "a/b", toKey: "c/d", metadataDirective: "REPLACE" });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = firstCommand(send) as InstanceType<typeof CopyObjectCommand>;
    expect(cmd).toBeInstanceOf(CopyObjectCommand);
    expect(cmd.input.Bucket).toBe("my-bucket");
    expect(cmd.input.Key).toBe("c/d");
    expect(cmd.input.CopySource).toBe("/my-bucket/a%2Fb");
    expect(cmd.input.MetadataDirective).toBe("REPLACE");
  });

  it("move copies then deletes in order", async () => {
    const order: string[] = [];
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof CopyObjectCommand) order.push("copy");
      if (cmd instanceof DeleteObjectCommand) order.push("delete");
      return {};
    });
    const client = makeClient({ send });
    await client.move({ fromKey: "old", toKey: "new" });

    expect(order).toEqual(["copy", "delete"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("move does not delete when copy fails", async () => {
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof CopyObjectCommand) throw new Error("copy failed");
      return {};
    });
    const client = makeClient({ send });

    await expect(client.move({ fromKey: "old", toKey: "new" })).rejects.toThrow("copy failed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("head returns mapped fields on success", async () => {
    const send = vi.fn(async () => ({
      ContentType: "image/png",
      ContentLength: 99,
      ETag: "\"t\"",
      Metadata: { userId: "1" },
      LastModified: new Date("2026-06-01")
    }));
    const client = makeClient({ send });
    const res = await client.head("k");

    expect(send).toHaveBeenCalledTimes(1);
    expect(firstCommand(send)).toBeInstanceOf(HeadObjectCommand);
    expect(res).toEqual({
      key: "k",
      contentType: "image/png",
      contentLength: 99,
      etag: "\"t\"",
      metadata: { userId: "1" },
      lastModified: new Date("2026-06-01")
    });
  });

  it("head returns null for NotFound", async () => {
    const send = vi.fn(async () => {
      const err = Object.assign(new Error("not found"), { name: "NotFound" });
      throw err;
    });
    const client = makeClient({ send });
    await expect(client.head("missing")).resolves.toBeNull();
  });

  it("head returns null for HTTP 404 metadata", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("404"), { $metadata: { httpStatusCode: 404 } });
    });
    const client = makeClient({ send });
    await expect(client.head("missing")).resolves.toBeNull();
  });

  it("head rethrows other errors", async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("boom"), { name: "SlowDown" });
    });
    const client = makeClient({ send });
    await expect(client.head("k")).rejects.toThrow("boom");
  });

  it("getPublicUrl delegates to config.publicBaseUrl", () => {
    const client = makeClient({ send: vi.fn() });
    expect(client.getPublicUrl("path/to/x.webp")).toBe("https://cdn.example.com/path/to/x.webp");
  });

  it("getSignedUrl throws when no base URL available", async () => {
    const client = createR2ClientFromS3({
      config: baseConfig({ publicBaseUrl: undefined }),
      s3: { send: vi.fn() } as any
    });

    await expect(client.getSignedUrl("k", { expiresIn: 60, secret: "s" })).rejects.toBeInstanceOf(SigningError);
  });

  it("getSignedUrl uses options.baseUrl over publicBaseUrl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const client = makeClient({ send: vi.fn() });
    const url = await client.getSignedUrl("key.webp", {
      expiresIn: 60,
      secret: "sec",
      baseUrl: "https://files.other.com"
    });
    expect(url.startsWith("https://files.other.com/key.webp")).toBe(true);
    vi.useRealTimers();
  });

  it("uploadFromUrl forwards config and bucket to uploadFromUrl", async () => {
    const send = vi.fn(async () => ({}));
    const client = createR2ClientFromS3({
      config: baseConfig({ defaultKeyStrategy: () => "custom" }),
      s3: { send } as any
    });

    await client.uploadFromUrl("https://example.com/a.png");

    expect(uploadFromUrlFn).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "my-bucket",
        url: "https://example.com/a.png",
        publicBaseUrl: "https://cdn.example.com",
        defaultKeyStrategy: expect.any(Function)
      })
    );
  });
});
