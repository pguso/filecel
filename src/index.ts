export { createR2Client } from "./client/createR2Client.js";
export type {
  R2Client,
  R2ClientConfig,
  UploadFromUrlOptions,
  UploadFromUrlResult,
  ListOptions,
  ListResult,
  ListItem,
  CopyOptions,
  MoveOptions,
  HeadResult,
  SignedUrlOptions
} from "./types.js";

export {
  FetchError,
  ValidationError,
  UploadError,
  SigningError,
  R2Error
} from "./errors.js";

export { createKey, type KeyInput, type KeyKind } from "./keys/createKey.js";
export { signWorkerUrl, verifyWorkerSignature } from "./signedUrl/workerHmac.js";

