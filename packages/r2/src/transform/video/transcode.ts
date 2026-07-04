import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { TranscodeTransform } from "../../types.js";
import { TransformError } from "../../errors.js";
import { resolveFfmpegPath } from "../loadDeps.js";

const FORMAT_MIME: Record<NonNullable<TranscodeTransform["format"]>, string> = {
  mp4: "video/mp4",
  webm: "video/webm"
};

export type TranscodeSource = Uint8Array | { tempFilePath: string };

export type TranscodeResult = {
  data: Uint8Array;
  contentType: string;
};

function videoCodecArgs(transform: TranscodeTransform): string[] {
  const format = transform.format ?? "mp4";
  const videoCodec = transform.videoCodec ?? (format === "webm" ? "vp9" : "h264");
  const audioCodec = transform.audioCodec ?? (format === "webm" ? "opus" : "aac");

  const args: string[] = [];
  if (videoCodec === "h264") args.push("-c:v", "libx264");
  else if (videoCodec === "vp9") args.push("-c:v", "libvpx-vp9");
  else throw new TransformError(`Unsupported videoCodec: ${videoCodec}`, { transform });

  if (audioCodec === "aac") args.push("-c:a", "aac");
  else if (audioCodec === "opus") args.push("-c:a", "libopus");
  else throw new TransformError(`Unsupported audioCodec: ${audioCodec}`, { transform });

  return args;
}

function scaleFilter(transform: TranscodeTransform): string | undefined {
  if (transform.width !== undefined && transform.height !== undefined) {
    return `scale=${transform.width}:${transform.height}`;
  }
  if (transform.width !== undefined) return `scale=${transform.width}:-2`;
  if (transform.height !== undefined) return `scale=-2:${transform.height}`;
  return undefined;
}

function inputExt(contentType?: string): string {
  if (!contentType) return ".bin";
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("quicktime")) return ".mov";
  return ".bin";
}

async function ensureInputFile(
  source: TranscodeSource,
  contentType?: string
): Promise<{ inputPath: string; cleanupDir?: string }> {
  if (typeof source === "object" && "tempFilePath" in source) {
    return { inputPath: source.tempFilePath };
  }
  const dir = await mkdtemp(join(tmpdir(), "filecel-transcode-"));
  const inputPath = join(dir, `input${inputExt(contentType)}`);
  await writeFile(inputPath, source);
  return { inputPath, cleanupDir: dir };
}

function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

export async function transcodeVideo(
  source: TranscodeSource,
  transform: TranscodeTransform,
  contentType?: string
): Promise<TranscodeResult> {
  const ffmpeg = await resolveFfmpegPath();
  const format = transform.format ?? "mp4";
  const crf = transform.crf ?? 23;
  const { inputPath, cleanupDir } = await ensureInputFile(source, contentType);

  const workDir = cleanupDir ?? (await mkdtemp(join(tmpdir(), "filecel-transcode-")));
  const outputPath = join(workDir, `output.${format}`);

  const args = ["-y", "-i", inputPath, ...videoCodecArgs(transform), "-crf", String(crf)];
  const scale = scaleFilter(transform);
  if (scale) args.push("-vf", scale);
  args.push(outputPath);

  try {
    await runFfmpeg(ffmpeg, args);
    const data = new Uint8Array(await readFile(outputPath));
    return { data, contentType: FORMAT_MIME[format] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ENOENT") || (err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new TransformError(
        "ffmpeg is required for video transcode. Install ffmpeg on PATH, set FFMPEG_PATH, or install ffmpeg-static.",
        { transform, cause: err }
      );
    }
    throw new TransformError(`Video transcode failed: ${message}`, { transform, cause: err });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function writeSourceToTempFile(
  source: Uint8Array,
  contentType?: string
): Promise<{ tempFilePath: string; cleanupDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), `filecel-src-${randomUUID()}-`));
  const tempFilePath = join(dir, `source${inputExt(contentType)}`);
  await writeFile(tempFilePath, source);
  return { tempFilePath, cleanupDir: dir };
}
