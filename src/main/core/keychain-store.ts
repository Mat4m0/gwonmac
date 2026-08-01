import { AppError, type ErrorCode } from "../../shared/errors.js";
import type { NativeKeychain, SecretSlot } from "./native-keychain.js";

/**
 * The refusals the native module classifies, keyed by the identifier it puts
 * on its rejection. A `Map` rather than an object literal: the lookup runs on
 * a `code` this process did not write, and `Object.prototype` members would
 * otherwise answer it.
 */
const NATIVE_REFUSALS = new Map<string, ErrorCode>([
  ["interaction_not_allowed", "keychain_locked"],
  ["missing_entitlement", "keychain_unentitled"],
]);

function nativeRefusal(error: unknown): ErrorCode | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const { code } = error;
  return typeof code === "string" ? NATIVE_REFUSALS.get(code) ?? null : null;
}

export interface KeychainSecret<T> {
  parse(value: unknown): T;
  unavailable(): AppError;
  corrupt(): AppError;
}

/** One validated JSON secret in one fixed native Keychain slot. */
export class KeychainJsonStore<T> {
  private tail: Promise<void> = Promise.resolve();
  private readonly slot: SecretSlot;
  private readonly keychain: NativeKeychain;
  private readonly secret: KeychainSecret<T>;

  constructor(
    slot: SecretSlot,
    keychain: NativeKeychain,
    secret: KeychainSecret<T>,
  ) {
    this.slot = slot;
    this.keychain = keychain;
    this.secret = secret;
  }

  load(): Promise<T | null> {
    return this.enqueue(async () => {
      const bytes = await this.native(() => this.keychain.load(this.slot));
      if (!bytes) return null;
      try {
        const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return this.secret.parse(JSON.parse(json));
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw this.secret.corrupt();
      } finally {
        bytes.fill(0);
      }
    });
  }

  async save(value: unknown): Promise<void> {
    const cleaned = this.secret.parse(value);
    await this.enqueue(async () => {
      const bytes = Buffer.from(JSON.stringify(cleaned), "utf8");
      try {
        await this.native(() => this.keychain.save(this.slot, bytes));
      } finally {
        bytes.fill(0);
      }
    });
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.native(() => this.keychain.clear(this.slot)));
  }

  private async native<R>(operation: () => Promise<R>): Promise<R> {
    try {
      return await operation();
    } catch (error) {
      const refusal = nativeRefusal(error);
      // This module is below the diagnostics redactor and cannot reach it, so
      // the rejection is logged as the two bounded parts of it: how the
      // Keychain refused, and what kind of thing was thrown. Its message and
      // stack are text this process did not author and stay on the error.
      console.warn(
        "Keychain operation failed",
        this.slot,
        refusal ?? "unclassified",
        error instanceof Error ? error.name : typeof error,
      );
      if (refusal === null) throw this.secret.unavailable();
      throw new AppError(refusal, "the Keychain refused this secret", {
        cause: error,
      });
    }
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
