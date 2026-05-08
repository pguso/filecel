import { describe, expect, it, vi } from "vitest";
import { signWorkerUrl, verifyWorkerSignature } from "../src/signedUrl/workerHmac.js";
import { SigningError } from "../src/errors.js";

describe("signWorkerUrl", () => {
  it("generates deterministic sig for fixed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const url = signWorkerUrl({
      baseUrl: "https://media.example.com",
      key: "users/1/images/a.webp",
      expiresIn: 60,
      secret: "test_secret",
      salt: "s"
    });

    const u = new URL(url);
    expect(u.origin).toBe("https://media.example.com");
    expect(u.pathname).toBe("/users/1/images/a.webp");
    expect(u.searchParams.get("exp")).toBe(String(1767225660));
    expect(u.searchParams.get("salt")).toBe("s");

    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig")!;
    expect(verifyWorkerSignature({ key: "users/1/images/a.webp", exp, sig, secret: "test_secret", salt: "s" })).toBe(
      true
    );
    vi.useRealTimers();
  });

  it("rejects non-positive expiresIn", () => {
    expect(() =>
      signWorkerUrl({
        baseUrl: "https://x.com",
        key: "k",
        expiresIn: 0,
        secret: "s"
      })
    ).toThrow(SigningError);

    expect(() =>
      signWorkerUrl({
        baseUrl: "https://x.com",
        key: "k",
        expiresIn: -1,
        secret: "s"
      })
    ).toThrow(SigningError);

    expect(() =>
      signWorkerUrl({
        baseUrl: "https://x.com",
        key: "k",
        expiresIn: Number.NaN,
        secret: "s"
      })
    ).toThrow(SigningError);
  });

  it("merges queryParams into signed URL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const url = signWorkerUrl({
      baseUrl: "https://media.example.com",
      key: "a.webp",
      expiresIn: 60,
      secret: "test_secret",
      queryParams: { download: "1", v: "2" }
    });
    const u = new URL(url);
    expect(u.searchParams.get("download")).toBe("1");
    expect(u.searchParams.get("v")).toBe("2");
    vi.useRealTimers();
  });
});

describe("verifyWorkerSignature", () => {
  it("returns false for wrong signature", () => {
    expect(
      verifyWorkerSignature({
        key: "k",
        exp: 100,
        sig: "deadbeef",
        secret: "secret"
      })
    ).toBe(false);
  });

  it("returns false when exp does not match payload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const url = signWorkerUrl({
      baseUrl: "https://x.com",
      key: "k",
      expiresIn: 60,
      secret: "s"
    });
    const u = new URL(url);
    const sig = u.searchParams.get("sig")!;
    const exp = Number(u.searchParams.get("exp"));
    vi.useRealTimers();

    expect(verifyWorkerSignature({ key: "k", exp: exp + 1, sig, secret: "s" })).toBe(false);
  });

  it("returns false when salt differs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const url = signWorkerUrl({
      baseUrl: "https://x.com",
      key: "k",
      expiresIn: 60,
      secret: "s",
      salt: "a"
    });
    const u = new URL(url);
    const sig = u.searchParams.get("sig")!;
    const exp = Number(u.searchParams.get("exp"));
    vi.useRealTimers();

    expect(verifyWorkerSignature({ key: "k", exp, sig, secret: "s", salt: "b" })).toBe(false);
  });
});
