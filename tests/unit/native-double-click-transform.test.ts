// The transform that gives the client's mouse double-click flag its missing
// byte. `internal/upstream/mouse-double-click.md` records why the flag exists
// and why nothing writes it.
//
// Every module here is built in the test rather than read from a downloaded
// client: game binaries are not committed, and the guards are what this file
// is about. What it proves is that the rewrite is refused unless the callback
// it is about to edit is byte-for-byte the one that was certified — the whole
// safety argument, since the inserted store depends on local 3 being the frame
// pointer and on the record sitting at a known offset from it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  DOUBLE_CLICK_FLAG_EXPORT,
  deriveNativeDoubleClickBuild,
  NATIVE_DOUBLE_CLICK_BUILDS,
  rewriteWithBuild,
  type NativeDoubleClickBuild,
} from "../../src/main/certification/native-double-click.ts";
import { ENHANCEMENT_BUILDS } from "../../src/main/certification/enhancement-builds.ts";
import {
  indexOfBytes,
  parseExports,
  sectionById,
  splitSections,
} from "../../src/main/core/wasm-binary.ts";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const section = (id: number, body: number[]) => [id, body.length, ...body];

/**
 * A module shaped like the part of the client this transform touches: one
 * function reachable through an active table slot, a global section, and an
 * export section. The body ends in `local.get 3` so the insertion point has
 * something recognisable behind it.
 */
function buildModule(
  elementBody: number[] = [0x01, 0x00, 0x41, 0x00, 0x0b, 0x01, 0x01],
): { bytes: Uint8Array; body: Uint8Array } {
  // (func (result i32)) — the callback's own signature is irrelevant here;
  // what matters is that the body is a body and the slot resolves to it.
  const types = section(1, [0x01, 0x60, 0x00, 0x01, 0x7f]);
  // One function import, so the defined function is index 1 and the transform
  // has to subtract the import count the way it does against the real client.
  const imports = section(2, [0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00]);
  const functions = section(3, [0x01, 0x00]);
  const table = section(4, [0x01, 0x70, 0x00, 0x01]);
  // The inserted instruction stores to linear memory and reads local 3, so a
  // module without both would fail validation for reasons the transform is not
  // responsible for.
  const memory = section(5, [0x01, 0x00, 0x01]);
  const globals = section(6, [0x01, 0x7f, 0x01, 0x41, 0x00, 0x0b]);
  const exportName = [...new TextEncoder().encode("existing")];
  const exports = section(7, [
    0x01,
    exportName.length,
    ...exportName,
    0x00,
    0x00,
  ]);
  const elements = section(9, elementBody);
  // four i32 locals, so local 3 exists; then `i32.const 7`, `drop`,
  // `i32.const 0`, `end`.
  const bodyBytes = [0x01, 0x04, 0x7f, 0x41, 0x07, 0x1a, 0x41, 0x00, 0x0b];
  const code = section(10, [0x01, bodyBytes.length, ...bodyBytes]);
  return {
    bytes: Uint8Array.from([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      ...types,
      ...imports,
      ...functions,
      ...table,
      ...memory,
      ...globals,
      ...exports,
      ...elements,
      ...code,
    ]),
    body: Uint8Array.from(bodyBytes),
  };
}

const entryFor = (
  body: Uint8Array,
  overrides: Partial<NativeDoubleClickBuild> = {},
): NativeDoubleClickBuild => ({
  derivations: {},
  callbackTableSlot: 0,
  callbackFunctionIndex: 1,
  callbackParams: [],
  callbackResults: ["i32"],
  callbackBodySha256: sha256(body),
  // After the locals declaration and `i32.const 7; drop`, which is where the
  // record store goes in the real callback: before the enqueue and after the
  // fields it fills.
  flagStoreOffset: 6,
  flagStoreFrameOffset: 24,
  ...overrides,
});

test("appends one exported mutable global and writes it into the record", () => {
  const { bytes, body } = buildModule();
  // The transform validates its own output and throws when it does not hold,
  // so reaching the next line is the validity assertion.
  const output = rewriteWithBuild(bytes, entryFor(body));

  const sections = splitSections(output);
  const names = parseExports(sectionById(sections, 7));
  const flag = names.find((entry) => entry.name === DOUBLE_CLICK_FLAG_EXPORT);
  assert.ok(flag, "the flag global must be exported");
  assert.equal(flag.kind, 0x03, "the export must be a global, not a function");
  assert.equal(flag.index, 1, "it must be the global appended after the first");
  assert.equal(names.length, 2, "the module's own export must survive");

  // `local.get 3; global.get 1; i32.store align=2 offset=24`, inserted whole.
  const code = sectionById(sections, 10);
  assert.notEqual(
    indexOfBytes(
      code,
      Uint8Array.of(0x20, 0x03, 0x23, 0x01, 0x36, 0x02, 0x18),
      0,
    ),
    -1,
    "the flag store must appear in the rewritten body",
  );
});

test("locates an unchanged callback without a predecessor hash", () => {
  const { bytes, body } = buildModule();
  const baseline = entryFor(body);
  const located = deriveNativeDoubleClickBuild(bytes, [baseline]);
  assert.ok(located);
  assert.equal(located.callbackFunctionIndex, baseline.callbackFunctionIndex);
  assert.equal(located.callbackTableSlot, baseline.callbackTableSlot);
  assert.match(located.derivations[sha256(bytes)] ?? "", /^[0-9a-f]{64}$/);
  assert.equal(deriveNativeDoubleClickBuild(bytes, [baseline, baseline]), null);
});

test("refuses a callback whose body is not the certified one", () => {
  const { bytes, body } = buildModule();
  const wrong = entryFor(body, {
    callbackBodySha256: sha256(Uint8Array.of(1, 2, 3)),
  });
  assert.throws(
    () => rewriteWithBuild(bytes, wrong),
    /not the certified body/,
    "a body that changed by any byte must not be edited",
  );
});

test("refuses a table slot that no longer holds the certified function", () => {
  const { bytes, body } = buildModule();
  assert.throws(
    () => rewriteWithBuild(bytes, entryFor(body, { callbackFunctionIndex: 0 })),
    /holds function/,
  );
  assert.throws(
    () => rewriteWithBuild(bytes, entryFor(body, { callbackTableSlot: 9 })),
    /holds function/,
  );
});

test("refuses duplicate active table slots instead of accepting the last mapping", () => {
  const { bytes, body } = buildModule([
    0x02, 0x00, 0x41, 0x00, 0x0b, 0x01, 0x01, 0x00, 0x41, 0x00, 0x0b, 0x01,
    0x01,
  ]);
  assert.throws(
    () => rewriteWithBuild(bytes, entryFor(body)),
    /duplicate active table slot 0/,
  );
});

test("refuses to insert past the end of the body", () => {
  const { bytes, body } = buildModule();
  assert.throws(
    () => rewriteWithBuild(bytes, entryFor(body, { flagStoreOffset: 999 })),
    /outside the callback body/,
  );
});

test("refuses a module that already carries the flag export", () => {
  const { bytes, body } = buildModule();
  const once = rewriteWithBuild(bytes, entryFor(body));
  // The second pass sees its own output: the body hash has moved on, so the
  // body guard fires first. Re-certifying the moved body must still not let a
  // second flag global in.
  const sections = splitSections(once);
  const movedBody = sectionById(sections, 10).subarray(2);
  assert.throws(
    () => rewriteWithBuild(once, entryFor(movedBody)),
    /already exists/,
  );
});

test("the shipped entry describes one build and states its own offsets", () => {
  assert.equal(NATIVE_DOUBLE_CLICK_BUILDS.length, 1);
  for (const build of NATIVE_DOUBLE_CLICK_BUILDS) {
    assert.match(build.callbackBodySha256, /^[0-9a-f]{64}$/);
    // Every retained exact Enhancement profile must continue through this
    // stage. Template-only predecessors can also be present when their
    // callback proof matches this build, even if their memory layout is no
    // longer certified for Enhancement.
    const pairs = Object.entries(build.derivations);
    const expectedInputs = new Set([
      ...ENHANCEMENT_BUILDS.map((entry) => entry.sha256),
      ...ENHANCEMENT_BUILDS.flatMap((entry) =>
        Object.values(entry.outputSha256).filter(
          (value): value is string => value !== undefined,
        ),
      ),
    ]);
    const inputs = new Set(pairs.map(([input]) => input));
    for (const input of expectedInputs) {
      assert.ok(
        inputs.has(input),
        "every retained Enhancement output needs a double-click derivation",
      );
    }
    for (const [input, output] of pairs) {
      assert.match(input, /^[0-9a-f]{64}$/);
      assert.match(output, /^[0-9a-f]{64}$/);
      assert.notEqual(input, output);
    }
    assert.equal(
      new Set(pairs.map(([, output]) => output)).size,
      pairs.length,
      "each predecessor must derive a distinct module",
    );
    assert.ok(build.flagStoreOffset > 0);
    // The record base sits eight bytes above the frame pointer and the flag is
    // the fifth word of the record, so the store lands at frame+24. A different
    // value here would write over a field the client reads.
    assert.equal(build.flagStoreFrameOffset, 24);
  }
});
