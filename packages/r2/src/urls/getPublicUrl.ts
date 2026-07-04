import { SigningError } from "../errors.js";

export function getPublicUrl(params: { publicBaseUrl?: string; key: string }): string {
  const base = params.publicBaseUrl;
  if (!base) {
    throw new SigningError("Missing publicBaseUrl; cannot generate a public URL.");
  }
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const key = params.key.startsWith("/") ? params.key.slice(1) : params.key;
  return `${normalizedBase}/${encodeURI(key)}`;
}

