import type { ResizeTransform, TranscodeTransform, Transform } from "../types.js";

function stripExtension(key: string): { base: string; ext: string | undefined } {
  const lastSlash = key.lastIndexOf("/");
  const filename = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return { base: key, ext: undefined };
  }
  const prefix = lastSlash >= 0 ? key.slice(0, lastSlash + 1) : "";
  const name = filename.slice(0, dot);
  const ext = filename.slice(dot + 1);
  return { base: `${prefix}${name}`, ext };
}

function resizeSlug(transform: ResizeTransform): string {
  const parts: string[] = [];
  if (transform.width !== undefined) parts.push(`w${transform.width}`);
  if (transform.height !== undefined) parts.push(`h${transform.height}`);
  if (transform.fit && transform.fit !== "cover") parts.push(transform.fit.slice(0, 1));
  else if (transform.fit === "cover" && transform.width !== undefined && transform.height !== undefined) {
    parts.push("c");
  }
  if (parts.length === 0) parts.push("resize");
  return parts.join("-");
}

function resizeExt(transform: ResizeTransform): string {
  return transform.format ?? "webp";
}

function transcodeSlug(transform: TranscodeTransform): string {
  const parts: string[] = [];
  if (transform.width !== undefined) parts.push(`w${transform.width}`);
  if (transform.height !== undefined) parts.push(`h${transform.height}`);
  if (transform.videoCodec) parts.push(transform.videoCodec);
  if (parts.length === 0) parts.push("transcode");
  return parts.join("-");
}

function transcodeExt(transform: TranscodeTransform): string {
  return transform.format ?? "mp4";
}

export function createVariantKey(originalKey: string, transform: Transform): string {
  const { base } = stripExtension(originalKey);
  if (transform.type === "resize") {
    return `${base}/variants/${resizeSlug(transform)}.${resizeExt(transform)}`;
  }
  return `${base}/variants/${transcodeSlug(transform)}.${transcodeExt(transform)}`;
}

export function defaultVariantKeyStrategy(input: {
  originalKey: string;
  transform: Transform;
  index: number;
}): string {
  void input.index;
  return createVariantKey(input.originalKey, input.transform);
}
