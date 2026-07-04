import { describe, expect, it, vi } from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";

vi.mock("../src/transform/image/resize.js", () => ({
  resizeImage: vi.fn(async (_source: Uint8Array, transform: { width?: number }) => ({
    data: new Uint8Array([transform.width ?? 0, 1, 2]),
    contentType: "image/webp"
  }))
}));

const { uploadInstances } = vi.hoisted(() => ({
  uploadInstances: [] as { args: { params: { Body?: unknown } }; done: () => Promise<unknown> }[]
}));

vi.mock("@aws-sdk/lib-storage", () => {
  class UploadMock {
    constructor(public readonly args: { params: { Body?: unknown } }) {
      uploadInstances.push(this);
    }
    async done() {
      return { ETag: '"etag_stream"' };
    }
  }
  return { Upload: UploadMock };
});

import { uploadFromUrl } from "../src/upload/uploadFromUrl.js";
import { resizeImage } from "../src/transform/image/resize.js";

/** Minimal valid PNG (1×1) */
function png1x1(): Uint8Array {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function makeS3() {
  const puts: unknown[] = [];
  return {
    s3: {
      send: vi.fn(async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand) puts.push(cmd);
        return { ETag: puts.length === 1 ? '"original"' : '"variant"' };
      })
    } as any,
    puts
  };
}

describe("uploadFromUrl transforms", () => {
  it("uploads original then resize variants in buffer mode", async () => {
    const { s3, puts } = makeS3();
    globalThis.fetch = vi.fn(async () => {
      return new Response(Buffer.from(png1x1()) as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-length": String(png1x1().byteLength),
          "content-type": "image/png"
        }
      });
    }) as any;

    const result = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/img.png",
      publicBaseUrl: "https://media.example.com",
      options: {
        key: "users/1/images/a.png",
        transforms: [
          { type: "resize", width: 800, format: "webp" },
          { type: "resize", width: 200, height: 200, fit: "cover", format: "webp" }
        ]
      }
    });

    expect(result.key).toBe("users/1/images/a.png");
    expect(result.etag).toBe('"original"');
    expect(result.variants).toHaveLength(2);
    expect(result.variants?.[0]?.key).toBe("users/1/images/a/variants/w800.webp");
    expect(result.variants?.[1]?.key).toBe("users/1/images/a/variants/w200-h200-c.webp");
    expect(result.variants?.[0]?.publicUrl).toBe(
      "https://media.example.com/users/1/images/a/variants/w800.webp"
    );
    expect(puts).toHaveLength(3);
    expect(resizeImage).toHaveBeenCalledTimes(2);
  });
});
