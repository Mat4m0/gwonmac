import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeychainJsonStore, type KeychainSecret } from "../../src/main/core/keychain-store.js";
import type { NativeKeychain, SecretSlot } from "../../src/main/core/native-keychain.js";
import { AppError } from "../../src/shared/errors.js";

interface Value { value: string }

const secret: KeychainSecret<Value> = {
  parse(value: unknown): Value {
    if (
      typeof value !== "object"
      || value === null
      || Object.keys(value).length !== 1
      || typeof (value as { value?: unknown }).value !== "string"
    ) {
      throw this.corrupt();
    }
    return { value: (value as Value).value };
  },
  unavailable: () => new AppError("credentials_unavailable", "unavailable"),
  corrupt: () => new AppError("credentials_corrupt", "corrupt"),
};

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("KeychainJsonStore", () => {
  it("serializes overlapping writes and recovers its queue after failure", async () => {
    const gate = deferred();
    const trace: string[] = [];
    const keychain: NativeKeychain = {
      load: async () => null,
      save: async () => {
        trace.push("save:start");
        await gate.promise;
        trace.push("save:end");
      },
      clear: async () => {
        trace.push("clear");
      },
    };
    const store = new KeychainJsonStore("arenaNetCredentials", keychain, secret);
    const save = store.save({ value: "first" });
    const clear = store.clear();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(trace, ["save:start"]);
    gate.reject(new Error("injected"));
    await assert.rejects(save, { code: "credentials_unavailable" });
    await clear;
    assert.deepEqual(trace, ["save:start", "clear"]);
  });

  it("zeroes native save buffers on success and failure", async () => {
    for (const fail of [false, true]) {
      let captured: Buffer | undefined;
      const keychain: NativeKeychain = {
        load: async () => null,
        save: async (_slot: SecretSlot, value: Buffer) => {
          captured = value;
          if (fail) throw new Error("injected");
        },
        clear: async () => {},
      };
      const store = new KeychainJsonStore("arenaNetCredentials", keychain, secret);
      if (fail) {
        await assert.rejects(store.save({ value: "secret" }));
      } else {
        await store.save({ value: "secret" });
      }
      assert.ok(captured);
      assert.ok(captured.every((byte) => byte === 0));
    }
  });

  it("zeroes loaded native buffers after valid and corrupt payloads", async () => {
    for (const [bytes, valid] of [
      [Buffer.from('{"value":"secret"}'), true],
      [Buffer.from("not-json"), false],
    ] as const) {
      const keychain: NativeKeychain = {
        load: async () => bytes,
        save: async () => {},
        clear: async () => {},
      };
      const store = new KeychainJsonStore("arenaNetCredentials", keychain, secret);
      if (valid) {
        assert.deepEqual(await store.load(), { value: "secret" });
      } else {
        await assert.rejects(store.load(), { code: "credentials_corrupt" });
      }
      assert.ok(bytes.every((byte) => byte === 0));
    }
  });
});
