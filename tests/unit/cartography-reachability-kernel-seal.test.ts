import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HASH_BINDING,
  sealReachabilityLoaderSource,
  verifySealedReachabilityLoader,
} from "../../scripts/seal-cartography-reachability-kernel.mjs";

const loader = [
  "async function load(kernelBytes, kernelSha256) {",
  "  const kernelModule = await WebAssembly.compile(kernelBytes);",
  "  return kernelModule;",
  "}",
].join("\n");
const digest = "a".repeat(64);

describe("Cartography reachability kernel seal", () => {
  it("binds one reviewed digest before compiling native code", () => {
    const sealed = sealReachabilityLoaderSource(loader, digest);
    assert.doesNotThrow(() => verifySealedReachabilityLoader(sealed, digest));
    assert.match(sealed, new RegExp(`const ${HASH_BINDING} = "${digest}";`));
    assert.ok(
      sealed.indexOf(`kernelSha256 !== ${HASH_BINDING}`)
        < sealed.indexOf("WebAssembly.compile(kernelBytes)"),
    );
  });

  it("rejects malformed digests, duplicate compile boundaries, and resealing", () => {
    assert.throws(() => sealReachabilityLoaderSource(loader, "bad"), /SHA-256/);
    assert.throws(
      () => sealReachabilityLoaderSource(`${loader}\n${loader}`, digest),
      /compile boundary/,
    );
    const sealed = sealReachabilityLoaderSource(loader, digest);
    assert.throws(
      () => sealReachabilityLoaderSource(sealed, digest),
      /compile boundary/,
    );
    assert.throws(
      () => verifySealedReachabilityLoader(sealed, "b".repeat(64)),
      /missing or does not match/,
    );
  });
});
