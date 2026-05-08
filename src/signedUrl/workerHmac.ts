import { createHmac, timingSafeEqual } from "node:crypto";
import { SigningError } from "../errors.js";

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) throw new SigningError("baseUrl is required.");
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeKey(key: string): string {
  return key.startsWith("/") ? key.slice(1) : key;
}

function buildSigPayload(params: { key: string; exp: number; salt?: string }): string {
  // Keep this stable and easy to reproduce in a Worker.
  return `${params.key}\n${params.exp}\n${params.salt ?? ""}`;
}

function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export type SignWorkerUrlInput = {
  baseUrl: string;
  key: string;
  expiresIn: number;
  secret: string;
  salt?: string;
  queryParams?: Record<string, string>;
};

export function signWorkerUrl(input: SignWorkerUrlInput): string {
  if (!Number.isFinite(input.expiresIn) || input.expiresIn <= 0) {
    throw new SigningError("expiresIn must be a positive number (seconds).");
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const key = normalizeKey(input.key);
  const exp = Math.floor(Date.now() / 1000) + Math.floor(input.expiresIn);

  const payload = buildSigPayload({ key, exp, salt: input.salt });
  const sig = hmacSha256Hex(input.secret, payload);

  const url = new URL(`${baseUrl}/${encodeURI(key)}`);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  if (input.salt) url.searchParams.set("salt", input.salt);
  if (input.queryParams) {
    for (const [k, v] of Object.entries(input.queryParams)) url.searchParams.set(k, v);
  }
  return url.toString();
}

export type VerifyWorkerSignatureInput = {
  key: string;
  exp: number;
  sig: string;
  secret: string;
  salt?: string;
};

export function verifyWorkerSignature(input: VerifyWorkerSignatureInput): boolean {
  const key = normalizeKey(input.key);
  const expected = hmacSha256Hex(input.secret, buildSigPayload({ key, exp: input.exp, salt: input.salt }));
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(input.sig, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

