export type Metadata = Record<string, string>;

export type R2ClientConfig = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  region?: string;
  publicBaseUrl?: string;
  defaultKeyStrategy?: (input: DefaultKeyStrategyInput) => string;
  /**
   * Optional custom fetch implementation (e.g. undici, proxy-aware fetch).
   * If unset, globalThis.fetch is used.
   */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export type DefaultKeyStrategyInput = {
  url: string;
  contentType?: string;
  ext?: string;
  idempotencyKey?: string;
};

export type UploadFromUrlOptions = {
  key?: string;
  /** If provided, used by default key strategy for idempotent paths. */
  idempotencyKey?: string;
  metadata?: Metadata;
  /** Validate MIME type. If missing, no MIME validation is performed. */
  allowedMimeTypes?: string[];
  /** Maximum bytes allowed. Enforced via content-length or streaming byte counter. */
  maxBytes?: number;
  /** If content-length <= threshold, buffer and use PutObject. Default: 8 MiB. */
  bufferThresholdBytes?: number;
  /**
   * Additional fetch() options for downloading the source URL.
   * Note: `signal` is controlled by this library for timeouts/abort.
   */
  fetchInit?: Omit<RequestInit, "signal">;
  /** Fetch retries. Default: 3 attempts. */
  fetchMaxAttempts?: number;
  /** Upload retries (AWS SDK retries already apply; this wraps higher-level steps). Default: 2 attempts. */
  uploadMaxAttempts?: number;
  /** Timeout for the fetch request (ms). */
  fetchTimeoutMs?: number;
  /** Overall timeout for the whole operation (ms). */
  overallTimeoutMs?: number;
};

export type UploadFromUrlResult = {
  key: string;
  etag?: string;
  size?: number;
  contentType?: string;
  publicUrl?: string;
};

export type SignedUrlOptions = {
  /** e.g. 3600 */
  expiresIn: number;
  /** shared secret used by Worker */
  secret: string;
  /** optional salt (string included in signature) */
  salt?: string;
  /** override base URL for serving domain */
  baseUrl?: string;
  /** optional extra query params */
  queryParams?: Record<string, string>;
};

export type ListOptions = {
  prefix?: string;
  cursor?: string;
  limit?: number;
};

export type ListItem = {
  key: string;
  size?: number;
  etag?: string;
  lastModified?: Date;
};

export type ListResult = {
  items: ListItem[];
  nextCursor?: string;
};

export type CopyOptions = {
  fromKey: string;
  toKey: string;
  /** Default: COPY */
  metadataDirective?: "COPY" | "REPLACE";
};

export type MoveOptions = {
  fromKey: string;
  toKey: string;
};

export type HeadResult = {
  key: string;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  metadata?: Metadata;
  lastModified?: Date;
};

export type R2Client = {
  uploadFromUrl(url: string, options?: UploadFromUrlOptions): Promise<UploadFromUrlResult>;
  delete(key: string): Promise<void>;
  list(options?: ListOptions): Promise<ListResult>;
  copy(options: CopyOptions): Promise<void>;
  move(options: MoveOptions): Promise<void>;
  head(key: string): Promise<HeadResult | null>;
  getPublicUrl(key: string): string;
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>;
};

