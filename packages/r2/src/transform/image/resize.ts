import type { ResizeTransform } from "../../types.js";
import { TransformError } from "../../errors.js";
import { loadSharp } from "../loadDeps.js";

const FORMAT_MIME: Record<NonNullable<ResizeTransform["format"]>, string> = {
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
  avif: "image/avif"
};

export type ResizeResult = {
  data: Uint8Array;
  contentType: string;
};

export async function resizeImage(
  source: Uint8Array,
  transform: ResizeTransform
): Promise<ResizeResult> {
  if (transform.width === undefined && transform.height === undefined) {
    throw new TransformError("Resize transform requires at least width or height.", { transform });
  }

  const sharp = await loadSharp();
  const format = transform.format ?? "webp";
  const quality = transform.quality ?? 80;

  let pipeline = sharp(source);
  pipeline = pipeline.resize({
    width: transform.width,
    height: transform.height,
    fit: transform.fit ?? "cover"
  });

  switch (format) {
    case "webp":
      pipeline = pipeline.webp({ quality });
      break;
    case "jpeg":
      pipeline = pipeline.jpeg({ quality });
      break;
    case "png":
      pipeline = pipeline.png();
      break;
    case "avif":
      pipeline = pipeline.avif({ quality });
      break;
  }

  const data = new Uint8Array(await pipeline.toBuffer());
  return { data, contentType: FORMAT_MIME[format] };
}
