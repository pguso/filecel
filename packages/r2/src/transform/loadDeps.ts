import { TransformError } from "../errors.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFn = (input?: any) => any;

let sharpModule: SharpFn | null | undefined;

export async function loadSharp(): Promise<SharpFn> {
  if (sharpModule !== undefined) {
    if (!sharpModule) {
      throw new TransformError(
        "sharp is required for image transforms. Install it: npm install sharp"
      );
    }
    return sharpModule;
  }
  try {
    sharpModule = (await import("sharp")).default as SharpFn;
    return sharpModule;
  } catch {
    sharpModule = null;
    throw new TransformError(
      "sharp is required for image transforms. Install it: npm install sharp"
    );
  }
}

let ffmpegPath: string | null | undefined;

export async function resolveFfmpegPath(): Promise<string> {
  if (ffmpegPath !== undefined) {
    if (!ffmpegPath) {
      throw new TransformError(
        "ffmpeg is required for video transcode. Install ffmpeg on PATH, set FFMPEG_PATH, or install ffmpeg-static."
      );
    }
    return ffmpegPath;
  }

  if (process.env.FFMPEG_PATH) {
    ffmpegPath = process.env.FFMPEG_PATH;
    return ffmpegPath;
  }

  try {
    // Optional peer dependency
    const mod = await import("ffmpeg-static" as string);
    const path = typeof mod === "string" ? mod : (mod as { default?: string }).default;
    if (path) {
      ffmpegPath = path;
      return ffmpegPath;
    }
  } catch {
    // optional peer
  }

  ffmpegPath = "ffmpeg";
  return ffmpegPath;
}
