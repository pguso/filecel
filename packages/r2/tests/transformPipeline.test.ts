import { describe, expect, it, vi, beforeEach } from "vitest";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { TransformError } from "../src/errors.js";
import { runTransformPipeline } from "../src/transform/pipeline.js";

vi.mock("../src/transform/image/resize.js", () => ({
  resizeImage: vi.fn(async () => ({
    data: new Uint8Array([9, 9, 9]),
    contentType: "image/webp"
  }))
}));

vi.mock("../src/transform/video/transcode.js", () => ({
  transcodeVideo: vi.fn(async () => ({
    data: new Uint8Array([8, 8, 8]),
    contentType: "video/mp4"
  }))
}));

import { resizeImage } from "../src/transform/image/resize.js";
import { transcodeVideo } from "../src/transform/video/transcode.js";

function makeS3() {
  return {
    send: vi.fn(async () => ({ ETag: '"variant-etag"' }))
  } as any;
}

describe("runTransformPipeline", () => {
  beforeEach(() => {
    vi.mocked(resizeImage).mockClear();
    vi.mocked(transcodeVideo).mockClear();
  });

  it("runs resize transforms and uploads variants", async () => {
    const s3 = makeS3();
    const source = { kind: "buffer" as const, data: new Uint8Array([1, 2, 3]) };

    const variants = await runTransformPipeline({
      s3,
      bucket: "b",
      originalKey: "users/1/images/a.webp",
      contentType: "image/png",
      source,
      transforms: [
        { type: "resize", width: 800, format: "webp" },
        { type: "resize", width: 200, height: 200, fit: "cover", format: "webp" }
      ],
      publicBaseUrl: "https://media.example.com"
    });

    expect(variants).toHaveLength(2);
    expect(variants[0]?.key).toBe("users/1/images/a/variants/w800.webp");
    expect(variants[0]?.publicUrl).toBe("https://media.example.com/users/1/images/a/variants/w800.webp");
    expect(variants[1]?.key).toBe("users/1/images/a/variants/w200-h200-c.webp");
    expect(resizeImage).toHaveBeenCalledTimes(2);
    expect(transcodeVideo).not.toHaveBeenCalled();
    expect(s3.send).toHaveBeenCalledTimes(2);
    expect(s3.send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
  });

  it("runs transcode transform for video content type", async () => {
    const s3 = makeS3();
    const source = { kind: "tempFile" as const, tempFilePath: "/tmp/v.mp4", cleanupDir: "/tmp" };

    const variants = await runTransformPipeline({
      s3,
      bucket: "b",
      originalKey: "users/1/videos/a.mp4",
      contentType: "video/mp4",
      source,
      transforms: [{ type: "transcode", width: 1280, format: "mp4" }]
    });

    expect(variants).toHaveLength(1);
    expect(variants[0]?.key).toBe("users/1/videos/a/variants/w1280.mp4");
    expect(transcodeVideo).toHaveBeenCalledOnce();
  });

  it("rejects resize on video content type", async () => {
    const s3 = makeS3();
    const source = { kind: "buffer" as const, data: new Uint8Array([1]) };

    await expect(
      runTransformPipeline({
        s3,
        bucket: "b",
        originalKey: "a.mp4",
        contentType: "video/mp4",
        source,
        transforms: [{ type: "resize", width: 100 }]
      })
    ).rejects.toBeInstanceOf(TransformError);
  });

  it("skips failed transforms when transformErrorMode is skip", async () => {
    vi.mocked(resizeImage)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ data: new Uint8Array([1]), contentType: "image/webp" });

    const s3 = makeS3();
    const source = { kind: "buffer" as const, data: new Uint8Array([1]) };

    const variants = await runTransformPipeline({
      s3,
      bucket: "b",
      originalKey: "a.png",
      contentType: "image/png",
      source,
      transforms: [
        { type: "resize", width: 100 },
        { type: "resize", width: 200 }
      ],
      transformErrorMode: "skip"
    });

    expect(variants).toHaveLength(1);
    expect(variants[0]?.key).toBe("a/variants/w200.webp");
  });
});
