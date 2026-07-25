import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  applyTemplateSaveCompatibility,
  rewriteTemplateSaveWasm,
  type KnownTemplateSaveBuild,
} from "../../src/main/core/template-save-compat.js";

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

function fixture(): { bytes: Uint8Array; callOffset: number } {
  const type = section(1, [1, 0x60, 2, 0x7f, 0x7f, 1, 0x7f]);
  const importBody = [
    2,
    1, 109, 1, 97, 0, 0,
    1, 109, 1, 98, 0, 0,
  ];
  const imports = section(2, importBody);
  const functions = section(3, [1, 0]);
  const body = [0, 0x20, 0, 0x20, 1, 0x10, 0, 0x0b];
  const code = section(10, [1, ...uleb(body.length), ...body]);
  const bytes = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...type,
    ...imports,
    ...functions,
    ...code,
  ]);
  const callOffset = bytes.findIndex(
    (byte, index) => byte === 0x10 && bytes[index + 1] === 0,
  );
  return { bytes, callOffset };
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function certifiedFixture(): {
  input: Uint8Array;
  build: KnownTemplateSaveBuild;
} {
  const { bytes: input, callOffset } = fixture();
  const expectedCall = [0x10, 0];
  const replacementCall = [0x10, 1];
  const expectedOutput = input.slice();
  expectedOutput.set(replacementCall, callOffset);
  return {
    input,
    build: {
      sha256: hash(input),
      outputSha256: hash(expectedOutput),
      callOffset,
      expectedCall,
      replacementCall,
    },
  };
}

describe("template-save WASM compatibility transform", () => {
  it("rewrites only the certified call target and remains valid", () => {
    const { input, build } = certifiedFixture();
    const output = rewriteTemplateSaveWasm(input, build);
    assert.equal(WebAssembly.validate(output), true);
    assert.deepEqual(
      Array.from(output.slice(build.callOffset, build.callOffset + 2)),
      [0x10, 1],
    );
    assert.deepEqual(
      Array.from(input.slice(build.callOffset, build.callOffset + 2)),
      [0x10, 0],
    );
  });

  it("rejects hash, signature, and expected-output drift", () => {
    const { input, build } = certifiedFixture();
    assert.throws(
      () => rewriteTemplateSaveWasm(input, { ...build, sha256: "0".repeat(64) }),
      /unsupported input/,
    );
    assert.throws(
      () => rewriteTemplateSaveWasm(input, {
        ...build,
        expectedCall: [0x10, 9],
      }),
      /call signature mismatch/,
    );
    assert.throws(
      () => rewriteTemplateSaveWasm(input, {
        ...build,
        outputSha256: "0".repeat(64),
      }),
      /unexpected output/,
    );
  });

  it("leaves unknown future client builds canonical", () => {
    const input = fixture().bytes;
    assert.equal(applyTemplateSaveCompatibility(input), input);
  });
});
