export type MediaKind = "image" | "video" | "unknown";

export function mediaKind(contentType?: string): MediaKind {
  if (!contentType) return "unknown";
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("video/")) return "video";
  return "unknown";
}
