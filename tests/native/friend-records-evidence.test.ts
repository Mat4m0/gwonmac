/** Exercise the pending Rust reader against synthetic memory, without authorizing a live layout. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { queueFixture } from "../fixtures/native-friend-queue.js";

const ROOT = 0x700000;
const ARRAY = 0x710000;
const RECORDS = 0x720000;
const OUTPUT = 0x730000;
const OUTPUT_BYTES = 4 + 128 * 96;

test("bounded companion friend decoding", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "gwonmac-friend-reader-"));
  try {
    const wasm = join(directory, "reader.wasm");
    execFileSync("rustc", [
      "tests/fixtures/friend-records-kernel.rs", "--target", "wasm32-unknown-unknown",
      "--crate-type", "cdylib", "--edition", "2021", "-A", "dead_code",
      "-C", "opt-level=2", "-C", "panic=abort",
      "-C", "link-arg=--import-memory", "-C", "link-arg=--initial-memory=16777216", "-C", "link-arg=--max-memory=16777216", "-o", wasm,
    ], { timeout: 30_000, stdio: "pipe" });
    const module = await WebAssembly.compile(new Uint8Array(await readFile(wasm)));
    function session(memory: WebAssembly.Memory) {
      const exports = new WebAssembly.Instance(module, { env: { memory } }).exports;
      const call = (name: string, ...args: number[]) => {
        const fn = exports[name];
        assert.ok(typeof fn === "function", `missing ${name}`);
        return fn(...args);
      };
      call("session_initialize");
      return {
        invalidate: () => call("session_invalidate"),
        requestSent: (requestId: number, connection: number) =>
          call("session_request_sent", requestId, connection),
        completionStarted: (requestId: number, connection: number, success: boolean) =>
          call("session_completion_started", requestId, connection, Number(success)),
        completionQueued: () => call("session_completion_queued"),
        completionFinished: () => call("session_completion_finished"),
        completionProcessed: () => call("session_completion_processed"),
        generation: () => call("session_generation") as number,
      };
    }
    function fixture(count = 3) {
      const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
      const instance = new WebAssembly.Instance(module, { env: { memory } });
      const decode = instance.exports.decode;
      assert.ok(memory instanceof WebAssembly.Memory && typeof decode === "function");
      const view = new DataView(memory.buffer);
      const write = (address: number, value: number) => view.setUint32(address, value, true);
      const name = (address: number, value: string) => {
        new Uint8Array(memory.buffer, address, 40).fill(0);
        for (let index = 0; index < value.length; index += 1) {
          view.setUint16(address + index * 2, value.charCodeAt(index), true);
        }
      };
      write(ROOT, ARRAY);
      write(ROOT + 4, count);
      write(ROOT + 8, count);
      function record(slot: number, uuid = slot, category = 1) {
        const address = RECORDS + slot * 172;
        write(ARRAY + slot * 4, address);
        write(address, category);
        write(address + 4, 1);
        write(address + 8, uuid);
        write(address + 104, slot);
        write(address + 108, 133);
        name(address + 24, "Fixture Alias");
        name(address + 64, "Fixture Character");
        return address;
      }
      return {
        write, record, name, view, memory,
        decode: (session = 1, root = ROOT) => decode(root, session, OUTPUT),
        count: () => view.getUint32(OUTPUT, true),
        key: (index = 0) => view.getBigUint64(OUTPUT + 4 + index * 96, true),
        unavailable() {
          assert.equal(decode(ROOT, 1, OUTPUT), 0);
          assert.equal(new Uint8Array(memory.buffer, OUTPUT, OUTPUT_BYTES).some((byte) => byte !== 0), false);
        },
      };
    }

    await t.test("reads records created, updated, removed, and replaced by the native functions", async () => {
      const path = process.env.GW_CLIENT_WASM;
      assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
      const native = await queueFixture(new Uint8Array(await readFile(path)));
      const instance = new WebAssembly.Instance(module, { env: { memory: native.memory } });
      const decode = instance.exports.decode;
      assert.ok(typeof decode === "function");
      const view = new DataView(native.memory.buffer);
      const table = native.friendTable();
      table.create(17);
      assert.equal(decode(table.root, 1, OUTPUT), 1);
      assert.equal(view.getUint32(OUTPUT, true), 1);
      const key = view.getBigUint64(OUTPUT + 4, true);
      assert.equal(view.getUint32(OUTPUT + 12, true), 4);
      assert.equal(view.getUint32(OUTPUT + 16, true), 0);
      assert.equal(view.getUint16(OUTPUT + 20, true), 65, "native alias copy");
      assert.equal(view.getUint16(OUTPUT + 60, true), 65, "native empty-character fallback to alias");
      table.status(1, 1);
      table.location(1, 133);
      assert.equal(decode(table.root, 1, OUTPUT), 1);
      assert.equal(view.getUint32(OUTPUT + 12, true), 1);
      assert.equal(view.getUint32(OUTPUT + 16, true), 133);
      table.remove(1);
      assert.equal(decode(table.root, 1, OUTPUT), 1);
      assert.equal(view.getUint32(OUTPUT, true), 0);
      table.create(99);
      assert.equal(decode(table.root, 1, OUTPUT), 1);
      assert.equal(view.getUint32(OUTPUT, true), 1);
      assert.notEqual(view.getBigUint64(OUTPUT + 4, true), key);
    });

    await t.test("accepts only the matching processed login completion", async () => {
      const path = process.env.GW_CLIENT_WASM;
      assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
      const native = await queueFixture(new Uint8Array(await readFile(path)));
      const gate = session(native.memory);
      native.onSession(gate);
      gate.requestSent(42, 7);
      native.completeLogin(0);
      assert.equal(gate.generation(), 0, "enqueue is not processing");
      native.drain();
      assert.equal(gate.generation(), 1);
      gate.invalidate();
      assert.equal(gate.generation(), 0, "invalidation withdraws synchronously");
    });

    await t.test("an old queued completion cannot admit the replacement login", async () => {
      const path = process.env.GW_CLIENT_WASM;
      assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
      const native = await queueFixture(new Uint8Array(await readFile(path)));
      const gate = session(native.memory);
      native.onSession(gate);
      gate.requestSent(42, 7);
      native.completeLogin(0);
      gate.invalidate();
      native.prepareLogin(43);
      gate.requestSent(43, 7);
      native.completeLogin(0);
      let processed = 0;
      native.onDelivery((id) => {
        if (id !== 14) return;
        processed += 1;
        // The fixture invokes completionProcessed after this callback returns.
        if (processed === 1) assert.equal(gate.generation(), 0);
      });
      native.drain();
      assert.equal(processed, 2);
      assert.equal(gate.generation(), 2);
    });

    await t.test("failed, mismatched, and dropped completions do not admit a session", async () => {
      const path = process.env.GW_CLIENT_WASM;
      assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
      const input = new Uint8Array(await readFile(path));
      for (const scenario of ["failed", "mismatched", "dropped"] as const) {
        const native = await queueFixture(input);
        const gate = session(native.memory);
        native.onSession(gate);
        gate.requestSent(scenario === "mismatched" ? 43 : 42, 7);
        if (scenario === "dropped") native.write(0x700000 + 20, 4);
        native.completeLogin(scenario === "failed" ? 7 : 0);
        native.drain();
        assert.equal(gate.generation(), 0, scenario);
      }
    });

    await t.test("impossible delivery order permanently refuses the session gate", () => {
      const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
      const gate = session(memory);
      gate.completionProcessed();
      gate.requestSent(42, 7);
      gate.completionStarted(42, 7, true);
      gate.completionQueued();
      gate.completionFinished();
      gate.completionProcessed();
      assert.equal(gate.generation(), 0);
    });

    await t.test("allocated empty and uninitialized storage have different decoding results", () => {
      const f = fixture();
      assert.equal(f.decode(), 1);
      assert.equal(f.count(), 0);
      f.write(ROOT, 0);
      f.unavailable();
    });

    await t.test("traverses sparse slots beyond the output limit and excludes other categories", () => {
      const f = fixture(300);
      f.record(1, 1, 2);
      f.record(299);
      assert.equal(f.decode(), 1);
      assert.equal(f.count(), 1);
      assert.equal(f.view.getUint32(OUTPUT + 4 + 12, true), 133);
    });

    await t.test("duplicate aliases remain distinct through UUID identity", () => {
      const f = fixture();
      f.record(1);
      f.record(2);
      assert.equal(f.decode(), 1);
      assert.equal(f.count(), 2);
      assert.notEqual(f.key(0), f.key(1));
    });

    await t.test("identity survives slot movement and changes after reuse or a new session", () => {
      const f = fixture();
      const address = f.record(1);
      assert.equal(f.decode(), 1);
      const original = f.key();
      f.write(ARRAY + 4, 0);
      f.write(ARRAY + 8, address);
      f.write(address + 104, 2);
      assert.equal(f.decode(), 1);
      assert.equal(f.key(), original);
      assert.equal(f.decode(2), 1);
      assert.notEqual(f.key(), original);
      f.write(address + 8, 55);
      assert.equal(f.decode(), 1);
      assert.notEqual(f.key(), original);
      assert.equal(f.decode(0), 0);
    });

    await t.test("duplicate and zero identities withdraw the complete result", () => {
      const f = fixture();
      f.record(1);
      const second = f.record(2);
      assert.equal(f.decode(), 1);
      f.write(second + 8, 1);
      f.unavailable();
      f.write(second + 8, 0);
      f.unavailable();
    });

    await t.test("malformed names refuse while valid surrogate pairs decode", () => {
      const f = fixture();
      const address = f.record(1);
      f.name(address + 24, "Fixture \u{1f43a}");
      assert.equal(f.decode(), 1);
      for (const invalid of ["", "\ud800", "\udc00", "a\nb", "x".repeat(20)]) {
        f.name(address + 24, invalid);
        f.unavailable();
      }
      f.name(address + 24, "Fixture Alias");
      f.name(address + 64, "");
      assert.equal(f.decode(), 1, "a missing current character is allowed");
    });

    await t.test("bad pointers, counts, capacity, and slot ownership refuse without trapping", () => {
      for (const [address, value] of [
        [ROOT, 0xfffffffc], [ROOT, ARRAY + 1], [ROOT + 4, 2],
        [ROOT + 4, 0x40000000], [ROOT + 8, 0], [ROOT + 8, 4097],
        [ARRAY, RECORDS], [ARRAY + 4, 0xfffffffc], [ARRAY + 4, RECORDS + 1],
      ]) {
        assert.ok(address !== undefined && value !== undefined);
        const f = fixture();
        f.record(1);
        f.write(address, value);
        f.unavailable();
      }
      const f = fixture();
      const address = f.record(1);
      f.write(address + 104, 2);
      f.unavailable();
      assert.equal(f.decode(1, 0xfffffffc), 0);
      assert.equal(f.decode(1, ROOT + 1), 0);
    });

    await t.test("unknown category or status refuses and output overflow never truncates", () => {
      const f = fixture();
      const address = f.record(1);
      f.write(address, 5);
      f.unavailable();
      f.write(address, 1);
      f.write(address + 4, 5);
      f.unavailable();
      const large = fixture(130);
      for (let slot = 1; slot < 130; slot += 1) large.record(slot);
      large.unavailable();
    });

    await t.test("every native status preserves the reported map without granting travel", () => {
      const f = fixture();
      const address = f.record(1);
      for (let status = 0; status <= 4; status += 1) {
        f.write(address + 4, status);
        assert.equal(f.decode(), 1);
        assert.equal(f.view.getUint32(OUTPUT + 4 + 8, true), status);
        assert.equal(f.view.getUint32(OUTPUT + 4 + 12, true), 133);
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
