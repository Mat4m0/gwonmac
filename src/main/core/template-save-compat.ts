import { createHash } from "node:crypto";

declare const WebAssembly: {
  validate(bytes: Uint8Array): boolean;
};

export const TEMPLATE_SAVE_TRANSFORM_ABI = 1;

export interface KnownTemplateSaveBuild {
  readonly sha256: string;
  readonly outputSha256: string;
  readonly callOffset: number;
  readonly expectedCall: readonly number[];
  readonly replacementCall: readonly number[];
}

export const TEMPLATE_SAVE_BUILDS: readonly KnownTemplateSaveBuild[] =
  Object.freeze([
    Object.freeze({
      sha256:
        "b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483",
      outputSha256:
        "1883197770cc74fe48d308f097359a08de839e29daec3829875ace587bb5d8d3",
      callOffset: 0x365a23,
      // `call 404`: ArenaNet's Emscripten PathCreateDirectory stub.
      expectedCall: Object.freeze([0x10, 0x94, 0x83, 0x80, 0x80, 0x00]),
      // `call 206`: __syscall_stat64 has the same (i32, i32) -> i32
      // signature. Argument 1 is an impossible stat buffer and marks this one
      // call for the renderer's synchronous mkdir bridge.
      replacementCall: Object.freeze([0x10, 0xce, 0x81, 0x80, 0x80, 0x00]),
    }),
  ]);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function findTemplateSaveBuild(
  inputSha256: string,
): KnownTemplateSaveBuild | null {
  return (
    TEMPLATE_SAVE_BUILDS.find((build) => build.sha256 === inputSha256) ?? null
  );
}

export function rewriteTemplateSaveWasm(
  input: Uint8Array,
  build: KnownTemplateSaveBuild,
): Uint8Array {
  const inputHash = sha256(input);
  if (inputHash !== build.sha256) {
    throw new Error(`template-save transform: unsupported input ${inputHash}`);
  }
  if (build.expectedCall.length !== build.replacementCall.length) {
    throw new Error("template-save transform: call widths differ");
  }
  const end = build.callOffset + build.expectedCall.length;
  if (
    build.callOffset < 0
    || end > input.byteLength
    || !build.expectedCall.every(
      (byte, index) => input[build.callOffset + index] === byte,
    )
  ) {
    throw new Error("template-save transform: call signature mismatch");
  }

  const output = input.slice();
  output.set(build.replacementCall, build.callOffset);
  const outputHash = sha256(output);
  if (outputHash !== build.outputSha256) {
    throw new Error(`template-save transform: unexpected output ${outputHash}`);
  }
  if (!WebAssembly.validate(output)) {
    throw new Error("template-save transform: rewritten module is invalid");
  }
  return output;
}

export function applyTemplateSaveCompatibility(
  input: Uint8Array,
): Uint8Array {
  const build = findTemplateSaveBuild(sha256(input));
  return build ? rewriteTemplateSaveWasm(input, build) : input;
}
