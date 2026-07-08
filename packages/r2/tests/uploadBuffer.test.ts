import { describe, expect, it, vi } from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { ValidationError } from "../src/errors.js";
import { uploadBuffer } from "../src/upload/uploadBuffer.js";

/** Minimal valid PNG (1×1) — file-type detects as image/png */
function png1x1(): Uint8Array {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function makeS3(sendImpl?: (cmd: unknown) => Promise<unknown>) {
  return {
    send: vi.fn(sendImpl ?? (async () => ({ ETag: "\"etag_put\"" })))
  } as any;
}

describe("uploadBuffer", () => {
  it("uploads buffer with PutObject using provided key and content type", async () => {
    const s3 = makeS3();
    const buffer = png1x1();

    const res = await uploadBuffer({
      s3,
      bucket: "b",
      buffer,
      options: {
        key: "users/u1/images/abc.png",
        contentType: "image/png",
        metadata: { userId: "u1" }
      }
    });

    expect(res.key).toBe("users/u1/images/abc.png");
    expect(res.contentType).toBe("image/png");
    expect(res.size).toBe(buffer.byteLength);
    expect(res.etag).toBe("\"etag_put\"");
    expect(s3.send).toHaveBeenCalledTimes(1);

    const cmd = s3.send.mock.calls[0][0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input.Key).toBe("users/u1/images/abc.png");
    expect(cmd.input.ContentType).toBe("image/png");
    expect(cmd.input.Metadata).toEqual({ userId: "u1" });
  });

  it("rejects when buffer exceeds maxBytes", async () => {
    const s3 = makeS3();
    const buffer = png1x1();

    await expect(
      uploadBuffer({
        s3,
        bucket: "b",
        buffer,
        options: { key: "k", maxBytes: 1 }
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(s3.send).not.toHaveBeenCalled();
  });

  it("rejects disallowed MIME types", async () => {
    const s3 = makeS3();
    const buffer = png1x1();

    await expect(
      uploadBuffer({
        s3,
        bucket: "b",
        buffer,
        options: {
          key: "k",
          contentType: "image/png",
          allowedMimeTypes: ["image/jpeg"]
        }
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(s3.send).not.toHaveBeenCalled();
  });

  it("sniffs MIME type when contentType is omitted", async () => {
    const s3 = makeS3();
    const buffer = png1x1();

    const res = await uploadBuffer({
      s3,
      bucket: "b",
      buffer,
      options: { key: "users/u1/images/abc.png" }
    });

    expect(res.contentType).toBe("image/png");
  });

  it("populates publicUrl when publicBaseUrl is set", async () => {
    const s3 = makeS3();
    const buffer = png1x1();

    const res = await uploadBuffer({
      s3,
      bucket: "b",
      buffer,
      publicBaseUrl: "https://media.example.com",
      options: {
        key: "users/u1/images/abc.png",
        contentType: "image/png"
      }
    });

    expect(res.publicUrl).toBe("https://media.example.com/users/u1/images/abc.png");
  });

  it("requires key", async () => {
    const s3 = makeS3();

    await expect(
      uploadBuffer({
        s3,
        bucket: "b",
        buffer: png1x1(),
        options: { contentType: "image/png" }
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(s3.send).not.toHaveBeenCalled();
  });
});
