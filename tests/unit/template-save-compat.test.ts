import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  rewriteTemplateSaveWasm,
  type KnownTemplateSaveBuild,
} from "../../src/main/certification/template-save-compat.js";

function uleb(value: number): number[] {
  const output: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    output.push(byte);
  } while (value);
  return output;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

/** The width LLVM uses for call targets, which the transform patches in place. */
function paddedCall(index: number): number[] {
  const bytes = [0x10];
  for (let position = 0; position < 5; position += 1) {
    bytes.push((index & 0x7f) | (position === 4 ? 0 : 0x80));
    index >>>= 7;
  }
  return bytes;
}

const STUB_BODY = [0x00, 0x41, 0x02, 0x0b];
const CALL_OFFSET = 5;

/**
 * One carrier import, one `i32.const 2` stub, and one caller that reaches it
 * through a padded call — the shape the production entry certifies.
 */
function fixture(): Uint8Array {
  const types = section(1, [
    2,
    0x60, 2, 0x7f, 0x7f, 1, 0x7f,
    0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
  ]);
  const imports = section(2, [1, 1, 109, 1, 97, 0, 1]);
  const functions = section(3, [2, 0, 0]);
  const exports = section(7, [
    1,
    6, ...[..."caller"].map((character) => character.charCodeAt(0)),
    0, 2,
  ]);
  const caller = [0x00, 0x20, 0x00, 0x20, 0x01, ...paddedCall(1), 0x0b];
  const code = section(10, [
    2,
    ...uleb(STUB_BODY.length),
    ...STUB_BODY,
    ...uleb(caller.length),
    ...caller,
  ]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...types,
    ...imports,
    ...functions,
    ...exports,
    ...code,
  ]);
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function draft(input: Uint8Array): KnownTemplateSaveBuild {
  return {
    sha256: hash(input),
    outputSha256: "0".repeat(64),
    importCount: 1,
    carrierImport: 0,
    bridges: [
      {
        kind: "ensureDirectory",
        stubFunction: 0,
        stubBody: STUB_BODY,
        callSites: [{ localFunction: 1, bodyOffset: CALL_OFFSET }],
      },
    ],
  };
}

/** Learn the derived hash the way a new client build would be certified. */
function certify(input: Uint8Array): KnownTemplateSaveBuild {
  const build = draft(input);
  try {
    rewriteTemplateSaveWasm(input, build);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const found = /unexpected output ([0-9a-f]{64})/.exec(message);
    if (found) return { ...build, outputSha256: found[1]! };
  }
  return assert.fail("fixture did not produce a derived module");
}

describe("template-save WASM compatibility transform", () => {
  it("routes the certified call site to the host behind a dirfd marker", () => {
    const input = fixture();
    const output = rewriteTemplateSaveWasm(input, certify(input));
    const moduleBytes = Uint8Array.from(output);
    assert.equal(WebAssembly.validate(moduleBytes), true);

    const seen: number[][] = [];
    const instance = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes), {
      m: {
        a: (...args: number[]) => {
          seen.push(args);
          return 0;
        },
      },
    });
    const caller = instance.exports.caller as (
      path: number,
      recursive: number,
    ) => number;

    assert.equal(caller(0x1234, 1), 0);
    assert.deepEqual(seen, [[-70001, 0x1234, 0, 1]]);
  });

  it("keeps the stub itself intact so uncertified callers are unaffected", () => {
    const input = fixture();
    const output = rewriteTemplateSaveWasm(input, certify(input));
    const stubbed = new WebAssembly.Instance(
      new WebAssembly.Module(Uint8Array.from(output)),
      {
        m: { a: () => assert.fail("the stub must not reach the host") },
      },
    );
    // Nothing else calls it here, but the body must still be the original
    // `i32.const 2` so the model paths that use it keep today's behaviour.
    assert.ok(stubbed instanceof WebAssembly.Instance);
    assert.ok(output.join(",").includes(STUB_BODY.join(",")));
  });

  it("rejects input, stub, call-site, and derived-output drift", () => {
    const input = fixture();
    const build = certify(input);
    assert.throws(
      () => rewriteTemplateSaveWasm(input, { ...build, sha256: "0".repeat(64) }),
      /unsupported input/,
    );
    assert.throws(
      () =>
        rewriteTemplateSaveWasm(input, {
          ...build,
          bridges: [{ ...build.bridges[0]!, stubBody: [0x00, 0x41, 0x09, 0x0b] }],
        }),
      /is not the expected stub/,
    );
    assert.throws(
      () =>
        rewriteTemplateSaveWasm(input, {
          ...build,
          bridges: [
            {
              ...build.bridges[0]!,
              callSites: [{ localFunction: 1, bodyOffset: CALL_OFFSET + 1 }],
            },
          ],
        }),
      /call site signature mismatch/,
    );
    assert.throws(
      () =>
        rewriteTemplateSaveWasm(input, {
          ...build,
          outputSha256: "0".repeat(64),
        }),
      /unexpected output/,
    );
  });

  // `Buffer.prototype.slice` returns a view, so a transform that sliced its
  // input and then wrote into a body would corrupt the caller's copy. Every
  // caller here reads the artifact with `readFile`, which yields a Buffer.
  it("never writes into the caller's input, Buffer or not", () => {
    const input = fixture();
    const build = certify(input);
    const asBuffer = Buffer.from(input);
    const before = hash(new Uint8Array(asBuffer));
    rewriteTemplateSaveWasm(asBuffer, build);
    assert.equal(hash(new Uint8Array(asBuffer)), before);

    const asArray = fixture();
    const arrayBefore = hash(asArray);
    rewriteTemplateSaveWasm(asArray, build);
    assert.equal(hash(asArray), arrayBefore);
  });
});
