export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (err: unknown, attempt: number) => boolean;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function jitter(n: number): number {
  const r = Math.random();
  return Math.floor(n * (0.8 + 0.4 * r));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T> | T,
  options: RetryOptions & { signal?: AbortSignal } = { maxAttempts: 1 }
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 10_000;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const shouldRetry = attempt < maxAttempts && (options.retryOn?.(err, attempt) ?? true);
      if (!shouldRetry) throw err;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(jitter(backoff), options.signal);
    }
  }

  throw lastErr;
}

