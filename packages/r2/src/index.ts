export { createR2Client } from "./client/createR2Client.js";
export type {
  R2Client,
  R2ClientConfig,
  UploadBufferOptions,
  UploadBufferResult,
  UploadFromUrlOptions,
  UploadFromUrlResult,
  ListOptions,
  ListResult,
  ListItem,
  CopyOptions,
  MoveOptions,
  HeadResult,
  SignedUrlOptions,
  ResizeTransform,
  TranscodeTransform,
  Transform,
  TransformVariantResult,
  VariantKeyStrategyInput
} from "./types.js";

export {
  FetchError,
  ValidationError,
  UploadError,
  SigningError,
  TransformError,
  R2Error
} from "./errors.js";

export { createKey, type KeyInput, type KeyKind } from "./keys/createKey.js";
export { signWorkerUrl, verifyWorkerSignature } from "./signedUrl/workerHmac.js";
export { createVariantKey, defaultVariantKeyStrategy } from "./transform/variantKey.js";
export { runTransformPipeline } from "./transform/pipeline.js";
export type { RunTransformPipelineInput, TransformSource } from "./transform/pipeline.js";

