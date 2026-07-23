export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
  }
}

export class GwError extends AppError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "GwError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("validation", message, options);
    this.name = "ValidationError";
  }
}

export class AllowlistError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("allowlist", message, options);
    this.name = "AllowlistError";
  }
}

export class NotReadyError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("not_ready", message, options);
    this.name = "NotReadyError";
  }
}

export class SecureStorageError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("secure_storage", message, options);
    this.name = "SecureStorageError";
  }
}

export class HttpStatusError extends AppError {
  readonly status: number;

  constructor(status: number, message?: string, options?: ErrorOptions) {
    super("http_status", message ?? `HTTP ${status}`, options);
    this.name = "HttpStatusError";
    this.status = status;
  }
}
