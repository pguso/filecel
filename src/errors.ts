export class R2Error extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class FetchError extends R2Error {
  readonly url: string;
  readonly status?: number;

  constructor(message: string, options: { url: string; status?: number; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.url = options.url;
    this.status = options.status;
  }
}

export class ValidationError extends R2Error {}

export class UploadError extends R2Error {
  readonly key: string;

  constructor(message: string, options: { key: string; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.key = options.key;
  }
}

export class SigningError extends R2Error {}

