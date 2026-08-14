/**
 * The closed catalogue of failure codes.
 *
 * Diagnostics carry the code and never the message. `AppError.message` is
 * English prose written for a human: it quotes paths, hostnames, manifest
 * entries and hash values, so it must never reach the flight recorder. The
 * code is the part that identifies a failure, and comparing two sessions must
 * not depend on matching prose.
 *
 * This list is the only way to introduce a code. `AppError` accepts
 * `ErrorCode`, not `string`, so an ad-hoc code is a compile error rather than
 * a new unbounded value in an export.
 */
export const ERROR_CODES = [
  "allowlist",
  "artifact_unverified",
  "bad_chunk_size",
  "bad_build_library",
  "bad_compression",
  "bad_digest",
  "bad_manifest",
  "bad_range",
  "bad_settings",
  "bad_window_state",
  "chunk_count",
  "chunk_decode",
  "chunk_index",
  "chunk_length",
  "chunk_offline",
  "credentials_corrupt",
  "credentials_unavailable",
  "disk_full",
  "dns_bad_reply",
  "dns_failed",
  "dns_no_a",
  "dns_rcode",
  "dns_timeout",
  "dns_truncated",
  "download_partial",
  "download_stopped",
  "fetch_failed",
  "hash_format",
  "hash_mismatch",
  "http_status",
  /** The Data Protection Keychain refused an item it would only release with
   * user interaction. The secret is intact and readable once the device is
   * unlocked, so this is not the same fault as a store that cannot be
   * reached at all. */
  "keychain_locked",
  /** The Keychain refused because the running process carries no application
   * identifier for the item's access group. Nothing the build does at runtime
   * recovers from that; only a re-signed one does. */
  "keychain_unentitled",
  "manifest_chunks",
  "manifest_cycle",
  "manifest_directories",
  "manifest_duplicate",
  "manifest_files",
  "manifest_format",
  "manifest_missing",
  "manifest_name",
  "manifest_parent",
  "manifest_required",
  "manifest_size",
  /** The transport gave up without ever receiving an HTTP answer: no
   * connection, no route, or a request that timed out. Distinguished from
   * `http_status` so the renderer can say "check your connection" instead of
   * blaming ArenaNet. */
  "net_offline",
  "not_ready",
  "proxy_path",
  "range_required",
  "response_limit",
  "response_too_large",
  "secure_storage",
  "short_write",
  "steam_session_corrupt",
  "steam_session_unavailable",
  /** Anything this process did not raise itself: a Node errno, a DOM
   * exception, a thrown non-Error. Their identifiers are an open set we do not
   * control, so they collapse to one value rather than widening the union. */
  "unknown",
  "unknown_proxy_route",
  "validation",
  /** A live probe was pointed at a user-data directory that is not the one it
   * asked for, so no client update was started. */
  "wrong_profile",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN.has(value);
}

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
  }
}

/**
 * The one extraction every diagnostic producer uses. Anything that is not an
 * `AppError` has no code we are willing to publish, so it becomes `"unknown"`.
 */
export function errorCode(error: unknown): ErrorCode {
  return error instanceof AppError ? error.code : "unknown";
}

export class GwError extends AppError {
  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
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
