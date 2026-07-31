import { AppError } from "../../shared/errors.js";
import type { NativeKeychain, SecretSlot } from "./native-keychain.js";

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
    } catch {
      throw this.secret.unavailable();
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
