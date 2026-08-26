import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  officialCodeGeneration,
  parseCertifiedClientRecord,
  parseCommand,
  RECORD,
  serializeCertifiedClientRecord,
} from "../../scripts/official-client.ts";
import { Manifest } from "../../src/main/core/manifest.js";
import { asDigest } from "../../src/shared/digest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CHUNK = 262_144;

function hashes(count: number, seed: string): string[] {
  return Array.from({ length: count }, (_, index) =>
    `${seed}${index}`.padEnd(64, "0"));
}

function manifest(overrides: {
  wasm?: string[];
  js?: string[];
  snapshot?: string[];
  version?: string[];
} = {}): Manifest {
  return new Manifest({
    compressionMode: "none",
    chunkSize: CHUNK,
    files: [
      {
        name: "Gw.jspi.wasm",
        size: 2 * CHUNK,
        chunkHashes: overrides.wasm ?? hashes(2, "aa"),
      },
      {
        name: "Gw.jspi.js",
        size: CHUNK,
        chunkHashes: overrides.js ?? hashes(1, "bb"),
      },
      {
        name: "Gw.snapshot",
        size: 3 * CHUNK,
        chunkHashes: overrides.snapshot ?? hashes(3, "cc"),
      },
      {
        name: "version.json",
        size: CHUNK,
        chunkHashes: overrides.version ?? hashes(1, "dd"),
      },
    ],
  });
}

describe("the published code generation", () => {
  it("is the identity of the two JSPI artifacts and nothing else", () => {
    const baseline = officialCodeGeneration(manifest());
    // Game content and the build marker are republished on schedules that have
    // nothing to do with the WASM. If either moved this identity, every content
    // patch would start a full derivation that concludes nothing changed.
    assert.equal(
      officialCodeGeneration(manifest({ snapshot: hashes(3, "ee") })),
      baseline,
    );
    assert.equal(
      officialCodeGeneration(manifest({ version: hashes(1, "ee") })),
      baseline,
    );
    assert.notEqual(
      officialCodeGeneration(manifest({ wasm: hashes(2, "ee") })),
      baseline,
    );
    assert.notEqual(
      officialCodeGeneration(manifest({ js: hashes(1, "ee") })),
      baseline,
    );
  });

  it("refuses a manifest that names no code artifact", () => {
    const withoutWasm = new Manifest({
      compressionMode: "none",
      chunkSize: CHUNK,
      files: [
        { name: "Gw.jspi.js", size: CHUNK, chunkHashes: hashes(1, "bb") },
      ],
    });
    assert.throws(
      () => officialCodeGeneration(withoutWasm),
      /missing Gw\.jspi\.wasm/,
    );
  });
});

describe("the command line", () => {
  const digest = asDigest("a".repeat(64));

  it("reads the three things this script does", () => {
    assert.deepEqual(parseCommand([]), { kind: "detect" });
    assert.deepEqual(parseCommand(["--download", "/tmp/official"]), {
      kind: "download",
      directory: "/tmp/official",
    });
    assert.deepEqual(parseCommand(["--record", digest]), {
      kind: "record",
      generation: digest,
    });
  });

  // Recording is given the generation the derivation certified, so a value that
  // is not a digest is a mistake rather than an invitation to go and fetch one:
  // whatever is published at record time may be a build nothing has certified.
  it("refuses a record it was not handed a generation for", () => {
    for (const argv of [
      ["--record"],
      ["--record", ""],
      ["--record", "not-a-digest"],
      ["--record", "A".repeat(64)],
      ["--record", "a".repeat(63)],
      ["--record", "--download", "/tmp/official"],
    ]) {
      assert.throws(() => parseCommand(argv), Error, argv.join(" "));
    }
  });

  it("refuses to fetch and record in the same run", () => {
    assert.throws(
      () => parseCommand(["--download", "/tmp/official", "--record", digest]),
      /run them apart/u,
    );
  });

  it("refuses a download with nowhere to put the bytes", () => {
    assert.throws(() => parseCommand(["--download"]), /needs a directory/u);
  });
});

describe("the recorded client generation", () => {
  const digest = asDigest("a".repeat(64));

  it("round-trips through its own serializer", () => {
    assert.deepEqual(
      parseCertifiedClientRecord(
        JSON.parse(serializeCertifiedClientRecord(digest)),
      ),
      { formatVersion: 1, codeGeneration: digest },
    );
  });

  // A record this cannot read must fail rather than resolve either way:
  // "changed" sends the deriver after a client that may be certified already,
  // and "unchanged" hides a patch forever.
  it("refuses everything it cannot read exactly", () => {
    for (const raw of [
      null,
      [],
      "a".repeat(64),
      {},
      { formatVersion: 2, codeGeneration: digest },
      { formatVersion: 1 },
      { formatVersion: 1, codeGeneration: "A".repeat(64) },
      { formatVersion: 1, codeGeneration: "a".repeat(63) },
      { formatVersion: 1, codeGeneration: digest, trustMe: true },
    ]) {
      assert.throws(() => parseCertifiedClientRecord(raw), Error, JSON.stringify(raw));
    }
  });

  it("is a tracked file the detector can read today", async () => {
    const record = parseCertifiedClientRecord(
      JSON.parse(await readFile(path.join(root, RECORD), "utf8")),
    );
    assert.equal(record.formatVersion, 1);
    assert.match(record.codeGeneration, /^[a-f0-9]{64}$/u);
  });

  it("binds downloaded bytes to the manifest returned by their update", async () => {
    const source = await readFile(path.join(root, "scripts/official-client.ts"), "utf8");
    assert.match(source, /\? \(await client\.update\(\)\)\.manifest/);
    assert.doesNotMatch(source, /const manifest = await client\.fetchManifest\(\)[\s\S]*client\.update\(\)/);
  });
});
