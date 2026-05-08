import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/retry/withRetry.js";

describe("withRetry", () => {
  it("retries until success", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("nope");
      return "ok";
    });

    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
    expect(res).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws last error when attempts exhausted", async () => {
    const err = new Error("final");
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry when retryOn returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("once");
    });

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 2,
        retryOn: () => false
      })
    ).rejects.toThrow("once");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws when signal is aborted before attempt", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));

    const fn = vi.fn(async () => "ok");

    await expect(withRetry(fn, { maxAttempts: 3, signal: controller.signal })).rejects.toThrow("stop");
    expect(fn).not.toHaveBeenCalled();
  });
});
