export class BootstrapError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class CloudflareApiError extends BootstrapError {
  readonly status: number;
  readonly code?: number;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status: number; code?: number; requestId?: string; cause?: unknown }
  ) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

export class BootstrapValidationError extends BootstrapError {}

