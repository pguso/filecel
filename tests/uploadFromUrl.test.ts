import { describe, expect, it, vi } from "vitest";

const { uploadInstances } = vi.hoisted(() => ({
  uploadInstances: [] as { args: { params: { Body?: unknown } }; done: () => Promise<unknown> }[]
}));

vi.mock("@aws-sdk/lib-storage", () => {
  class UploadMock {
    attempts = 0;
    constructor(public readonly args: { params: { Body?: { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } } }) {
      uploadInstances.push(this);
    }
    async done() {
      this.attempts++;
      const body = this.args.params.Body as ReadableStream<Uint8Array> | undefined;
      if (body && typeof (body as unknown as ReadableStream<Uint8Array>).getReader === "function") {
        const reader = (body as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } finally {
          reader.releaseLock?.();
        }
      }
      return { ETag: "\"etag_stream\"" };
    }
  }
  return { Upload: UploadMock };
});

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { uploadFromUrl } from "../src/upload/uploadFromUrl.js";
import { ValidationError } from "../src/errors.js";

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

describe("uploadFromUrl", () => {
  it("forwards options.fetchInit to fetch (headers, redirect)", async () => {
    const s3 = makeS3();
    const seen: { input?: RequestInfo | URL; init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.input = input;
      seen.init = init;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-length": "3",
          "content-type": "image/webp"
        }
      });
    }) as any;

    await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/with-init",
      options: {
        bufferThresholdBytes: 10,
        fetchInit: {
          redirect: "manual",
          headers: {
            "user-agent": "filecel-r2-test",
            authorization: "Bearer X"
          }
        }
      }
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(seen.input).toBe("https://example.com/with-init");
    expect(seen.init?.redirect).toBe("manual");
    const headers = seen.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer X");
  });

  it("ignores fetchInit.signal (library controls abort signal)", async () => {
    const s3 = makeS3();
    const provided = new AbortController();
    const signals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-length": "3",
          "content-type": "image/webp"
        }
      });
    }) as any;

    await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/signal",
      options: {
        bufferThresholdBytes: 10,
        // Not part of public type (it's Omit<..., 'signal'>) but we want to ensure runtime safety.
        fetchInit: { signal: provided.signal } as any
      }
    });

    expect(signals.length).toBe(1);
    expect(signals[0]).not.toBe(provided.signal);
  });

  it("buffers small content-length and uses PutObject", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-length": "3",
          "content-type": "image/webp"
        }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://replicate.delivery/x",
      options: { bufferThresholdBytes: 10 }
    });

    expect(res.etag).toBe("\"etag_put\"");
    expect(s3.send).toHaveBeenCalledTimes(1);
    expect(s3.send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
  });

  it("rejects when content-length exceeds maxBytes", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          "content-length": "999",
          "content-type": "image/webp"
        }
      });
    }) as any;

    await expect(
      uploadFromUrl({
        s3,
        bucket: "b",
        url: "https://replicate.delivery/x",
        options: { maxBytes: 10 }
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("uses streaming Upload when content-length is above bufferThresholdBytes", async () => {
    uploadInstances.length = 0;
    const s3 = makeS3();
    const png = png1x1();
    globalThis.fetch = vi.fn(async () => {
      return new Response(Buffer.from(png), {
        status: 200,
        headers: {
          "content-length": String(png.byteLength),
          "content-type": "image/png"
        }
      });
    }) as any;

    await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/obj.png",
      options: { bufferThresholdBytes: 10 }
    });

    expect(s3.send).not.toHaveBeenCalled();
    expect(uploadInstances.length).toBe(1);
  });

  it("uses streaming path when content-length is absent", async () => {
    uploadInstances.length = 0;
    const s3 = makeS3();
    const png = png1x1();
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(png);
            controller.close();
          }
        }),
        { status: 200, headers: { "content-type": "image/png" } }
      );
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/stream.png",
      options: { bufferThresholdBytes: 10_000 }
    });

    expect(res.contentType).toBe("image/png");
    expect(s3.send).not.toHaveBeenCalled();
    expect(uploadInstances.length).toBe(1);
  });

  it("sniffs MIME from buffer when content-type header is missing", async () => {
    const s3 = makeS3();
    const png = png1x1();
    globalThis.fetch = vi.fn(async () => {
      return new Response(Buffer.from(png), {
        status: 200,
        headers: { "content-length": String(png.byteLength) }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/x",
      options: { bufferThresholdBytes: 100_000 }
    });

    expect(res.contentType).toBe("image/png");
    expect(res.key).toMatch(/^uploads\/.*\.png$/);
  });

  it("rejects when allowedMimeTypes does not include detected type", async () => {
    const s3 = makeS3();
    const png = png1x1();
    globalThis.fetch = vi.fn(async () => {
      return new Response(Buffer.from(png), {
        status: 200,
        headers: { "content-length": String(png.byteLength) }
      });
    }) as any;

    await expect(
      uploadFromUrl({
        s3,
        bucket: "b",
        url: "https://example.com/x",
        options: {
          bufferThresholdBytes: 100_000,
          allowedMimeTypes: ["image/jpeg"]
        }
      })
    ).rejects.toThrow(/MIME type not allowed/);
  });

  it("uses options.key when provided", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3", "content-type": "image/webp" }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/x",
      options: { key: "custom/path/file.webp", bufferThresholdBytes: 10 }
    });

    expect(res.key).toBe("custom/path/file.webp");
    const cmd = s3.send.mock.calls[0][0] as PutObjectCommand;
    expect(cmd.input.Key).toBe("custom/path/file.webp");
  });

  it("uses idempotencyKey in default key strategy", async () => {
    const s3 = makeS3();
    const png = png1x1();
    globalThis.fetch = vi.fn(async () => {
      return new Response(Buffer.from(png), {
        status: 200,
        headers: { "content-length": String(png.byteLength) }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/x",
      options: { bufferThresholdBytes: 100_000, idempotencyKey: "pred_abc" }
    });

    expect(res.key).toBe("uploads/pred_abc.png");
  });

  it("includes publicUrl when publicBaseUrl is set", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3", "content-type": "image/webp" }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/x",
      publicBaseUrl: "https://cdn.example.com",
      options: { key: "k.webp", bufferThresholdBytes: 10 }
    });

    expect(res.publicUrl).toBe("https://cdn.example.com/k.webp");
  });

  it("omits publicUrl when publicBaseUrl is unset", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3", "content-type": "image/webp" }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/x",
      options: { key: "k.webp", bufferThresholdBytes: 10 }
    });

    expect(res.publicUrl).toBeUndefined();
  });

  it("throws FetchError on non-retryable HTTP status without retrying", async () => {
    const s3 = makeS3();
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    globalThis.fetch = fetchMock as any;

    await expect(
      uploadFromUrl({ s3, bucket: "b", url: "https://example.com/missing", options: { fetchMaxAttempts: 3 } })
    ).rejects.toMatchObject({ name: "FetchError", status: 404 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable fetch status then succeeds", async () => {
    const s3 = makeS3();
    const png = png1x1();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 503 });
      return new Response(Buffer.from(png), {
        status: 200,
        headers: { "content-length": String(png.byteLength), "content-type": "image/png" }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/x",
      options: { bufferThresholdBytes: 100_000, fetchMaxAttempts: 3 }
    });

    expect(res.contentType).toBe("image/png");
    expect(calls).toBe(2);
  });

  it("throws FetchError when stream response has no body", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any;

    await expect(uploadFromUrl({ s3, bucket: "b", url: "https://example.com/x" })).rejects.toMatchObject({
      name: "FetchError",
      message: expect.stringContaining("no body")
    });
  });

  it("enforces maxBytes on streamed body", async () => {
    uploadInstances.length = 0;
    const s3 = makeS3();
    const chunk = new Uint8Array(20);
    chunk.fill(1);
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
            controller.close();
          }
        }),
        { status: 200, headers: { "content-type": "application/octet-stream" } }
      );
    }) as any;

    const err = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/big.bin",
      options: { maxBytes: 10, bufferThresholdBytes: 1 }
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "UploadError" });
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(ValidationError);
    expect(uploadInstances.length).toBe(1);
  });

  it("wraps PutObject failure in UploadError", async () => {
    const s3 = makeS3(async () => {
      throw new Error("s3 refused");
    });
    globalThis.fetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3", "content-type": "image/webp" }
      });
    }) as any;

    await expect(
      uploadFromUrl({
        s3,
        bucket: "b",
        url: "https://example.com/x",
        options: { key: "fail.webp", bufferThresholdBytes: 10 }
      })
    ).rejects.toMatchObject({
      name: "UploadError",
      key: "fail.webp"
    });
  });

  it("uses custom defaultKeyStrategy when provided", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "3", "content-type": "image/webp" }
      });
    }) as any;

    const res = await uploadFromUrl({
      s3,
      bucket: "b",
      url: "https://example.com/x",
      options: { bufferThresholdBytes: 10 },
      defaultKeyStrategy: () => "strategy/custom"
    });

    expect(res.key).toBe("strategy/custom");
  });

  it("stops retrying fetch when overall timeout aborts", async () => {
    const s3 = makeS3();
    let fetchCalls = 0;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls++;
      const signal = init?.signal;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 80);
        const onAbort = () => {
          clearTimeout(t);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-length": "1" }
      });
    }) as any;

    await expect(
      uploadFromUrl({
        s3,
        bucket: "b",
        url: "https://example.com/slow",
        options: { overallTimeoutMs: 25, fetchMaxAttempts: 5 }
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchCalls).toBe(1);
  });

  it("fails fast when fetch exceeds fetchTimeoutMs", async () => {
    const s3 = makeS3();
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 60_000);
        const onAbort = () => {
          clearTimeout(t);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return new Response(new Uint8Array([1]), { status: 200, headers: { "content-length": "1" } });
    }) as any;

    await expect(
      uploadFromUrl({
        s3,
        bucket: "b",
        url: "https://example.com/hang",
        options: { fetchTimeoutMs: 20, fetchMaxAttempts: 3, bufferThresholdBytes: 10 }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
