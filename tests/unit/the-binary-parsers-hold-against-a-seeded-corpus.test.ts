// The four parsers that read bytes this project did not write: the chunk
// format, the patch manifest, LEB128 as ArenaNet's snapshots actually spell it,
// and the WebAssembly section walk. Their existing tests are hand-curated,
// which means they cover the inputs someone thought of — and the interesting
// input is by definition the one nobody thought of.
//
// So the corpus is generated, and the assertion is a property rather than an
// expected value: every one of these either produces a result that satisfies
// its own stated invariant, or refuses with this repository's error type. What
// it must never do is return something almost right.
//
// The generator is seeded and the round counts are fixed, so a run here costs
// the same on every machine and a failure names an exact case that reproduces.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { HASH_ALGOS } from "../../src/main/core/access-key.js";
import {
  decodeChunk,
  parseContentHash,
  verifyChunkHash,
} from "../../src/main/core/chunk-format.js";
import { Manifest } from "../../src/main/core/manifest.js";
import {
  concat,
  encodeCode,
  encodeIndexVector,
  encodeSection,
  paddedIndex,
  parseCode,
  parseIndexVector,
  parseTypes,
  readSleb,
  readUleb,
  sleb,
  splitSections,
  uleb,
  WASM_HEADER,
} from "../../src/main/core/wasm-binary.js";
import { AppError } from "../../src/shared/errors.js";

const ROUNDS = 200;

/** One stream per target, so adding a target does not reshuffle the others. */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function below(next: () => number, bound: number): number {
  return Math.floor(next() * bound);
}

function pick<T>(next: () => number, values: readonly T[]): T {
  return values[below(next, values.length)]!;
}

function randomBytes(next: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => below(next, 256));
}

/** What was thrown, once it is known to be an `Error`. */
function thrown(run: () => unknown, what: string): Error {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof Error, `${what} threw a non-Error`);
    return error;
  }
  return assert.fail(`${what} did not refuse`);
}

describe("LEB128 as the snapshots spell it", () => {
  /**
   * The same value in a wider encoding, which the format permits and a
   * generated snapshot constant really uses. A decoder that byte-matched a
   * canonical encoding would read these as different values.
   */
  function padUleb(value: number, width: number): Uint8Array {
    const out = new Uint8Array(width);
    let rest = value;
    for (let index = 0; index < width; index += 1) {
      out[index] = (rest & 0x7f) | (index === width - 1 ? 0 : 0x80);
      rest >>>= 7;
    }
    return out;
  }

  it("decodes every non-canonical width of the same unsigned value", () => {
    const next = stream(0x1f2e_3d4c);
    for (let round = 0; round < ROUNDS; round += 1) {
      const value = below(next, 0x1_0000_0000);
      const canonical = uleb(value);
      assert.equal(readUleb(canonical, { offset: 0 }), value, `round ${round}`);
      for (let width = canonical.byteLength; width <= 5; width += 1) {
        assert.equal(
          readUleb(padUleb(value, width), { offset: 0 }),
          value,
          `round ${round}, width ${width}`,
        );
      }
      assert.equal(readUleb(paddedIndex(value), { offset: 0 }), value, `round ${round}`);
    }
  });

  it("round-trips signed values and refuses what will not fit", () => {
    const next = stream(0x2a3b_4c5d);
    for (let round = 0; round < ROUNDS; round += 1) {
      const value = below(next, 0x1_0000_0000) - 0x8000_0000;
      assert.equal(readSleb(sleb(value), { offset: 0 }), value, `round ${round}`);

      const truncated = Uint8Array.from(
        { length: 1 + below(next, 4) },
        () => 0x80 | below(next, 128),
      );
      assert.match(
        thrown(() => readUleb(truncated, { offset: 0 }), `round ${round}`).message,
        /^wasm: truncated LEB128$/u,
      );

      const oversized = Uint8Array.from(
        { length: 6 + below(next, 4) },
        () => 0x80 | below(next, 128),
      );
      assert.match(
        thrown(() => readUleb(oversized, { offset: 0 }), `round ${round}`).message,
        /^wasm: oversized LEB128$/u,
      );
    }
  });
});

describe("the chunk format against generated input", () => {
  const HASH_CHARACTERS = "0123456789abcdefABCDEFghz-_ ";

  it("accepts exactly the digest shapes, and lower-cases what it accepts", () => {
    const next = stream(0x3b4c_5d6e);
    for (let round = 0; round < ROUNDS; round += 1) {
      const length = pick(next, [0, 1, 31, 32, 33, 40, 41, 63, 64, 65]);
      const candidate = Array.from(
        { length },
        () => HASH_CHARACTERS[below(next, HASH_CHARACTERS.length)]!,
      ).join("");
      const acceptable =
        HASH_ALGOS[length] !== undefined && /^[0-9a-fA-F]+$/u.test(candidate);
      if (acceptable) {
        assert.equal(parseContentHash(candidate), candidate.toLowerCase(), candidate);
      } else {
        const error = thrown(() => parseContentHash(candidate), `round ${round}`);
        assert.ok(error instanceof AppError, candidate);
        assert.equal(error.code, "hash_format", candidate);
      }
    }
  });

  it("verifies a chunk against its own digest and no other", () => {
    const next = stream(0x4c5d_6e7f);
    for (let round = 0; round < ROUNDS; round += 1) {
      const data = randomBytes(next, 1 + below(next, 64));
      const algorithm = pick(next, ["md5", "sha1", "sha256"] as const);
      const hash = createHash(algorithm).update(data).digest("hex");
      verifyChunkHash(hash, data);

      const at = below(next, hash.length);
      const wrong =
        hash.slice(0, at)
        + (hash[at] === "0" ? "1" : "0")
        + hash.slice(at + 1);
      const error = thrown(() => verifyChunkHash(wrong, data), `round ${round}`);
      assert.ok(error instanceof AppError, `round ${round}`);
      assert.equal(error.code, "hash_mismatch", `round ${round}`);
    }
  });

  it("never yields a decoded chunk of a length the manifest did not declare", async () => {
    const next = stream(0x5d6e_7f80);
    for (let round = 0; round < ROUNDS; round += 1) {
      const data = randomBytes(next, 1 + below(next, 96));
      const compressed = gzipSync(data);
      assert.deepEqual(
        await decodeChunk(compressed, "gzip", data.byteLength),
        Buffer.from(data),
        `round ${round}`,
      );
      assert.deepEqual(
        await decodeChunk(data, "none", data.byteLength),
        data,
        `round ${round}`,
      );

      for (const [what, run] of [
        ["an over-declared length", () => decodeChunk(compressed, "gzip", data.byteLength + 1)],
        ["a truncated gzip", () => decodeChunk(compressed.subarray(0, compressed.byteLength - 1), "gzip", data.byteLength)],
        ["raw bytes read as gzip", () => decodeChunk(data, "gzip", data.byteLength)],
        ["a length disagreement", () => decodeChunk(data, "none", data.byteLength + 1)],
      ] as const) {
        await assert.rejects(
          run,
          (error: unknown) => error instanceof AppError,
          `round ${round}: ${what}`,
        );
      }
    }
  });
});

describe("the patch manifest against generated input", () => {
  // Each field is sound most of the time and hostile the rest of it. A manifest
  // has eight or so independent fields, so drawing each one uniformly from a
  // pool of mostly-hostile values would refuse every round — and a refusal
  // proves nothing about the paths a caller is handed if nothing is ever
  // handed over. Over this seed, 57 of the 200 rounds parse.
  const HOSTILE_SHARE = 0.08;
  const HOSTILE_NAMES = [
    "..",
    ".",
    "",
    "/etc",
    "a/b",
    "a\\b",
    "a\0b",
    "__proto__",
    "prototype",
    "constructor",
    "n".repeat(256),
  ];
  const HOSTILE_SIZES = [0, -4, 4.5, "8", Number.MAX_SAFE_INTEGER];

  function hostile<T>(next: () => number, values: readonly T[], sound: T): T {
    return next() < HOSTILE_SHARE ? pick(next, values) : sound;
  }

  /**
   * A parent under `ceiling`, or one of the spellings that must be refused. A
   * self reference is in range and still a cycle, so it belongs with the
   * out-of-range values rather than with the sound draws.
   */
  function parentIndex(
    next: () => number,
    index: number,
    ceiling: number,
  ): unknown {
    return hostile(
      next,
      [-1, 1.5, "1", true, index, Number.MAX_SAFE_INTEGER],
      ceiling === 0 ? pick(next, [undefined, null]) : pick(next, [undefined, null, below(next, ceiling)]),
    );
  }

  function randomHash(next: () => number, length: number): string {
    return Array.from({ length }, () => "0123456789abcdef"[below(next, 16)]!).join("");
  }

  it("either refuses, or yields paths that may be joined onto a real directory", () => {
    const next = stream(0x6e7f_8091);
    // Named against whatever the rounds below actually reach, rather than
    // against the one key an author guessed at: any own property that was not
    // there before is pollution, whichever hostile name carried it.
    const untouched = Object.getOwnPropertyNames(Object.prototype);
    let accepted = 0;
    let paths = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const chunkSize = hostile(next, [0, -1, 4.5, 1 << 25], pick(next, [4, 8]));
      const directoryCount = below(next, 5);
      const raw = {
        compressionMode: hostile(next, ["brotli", 7, null], pick(next, ["none", "gzip"])),
        chunkSize,
        // A distinct sound name per index, so the rounds that refuse do so for
        // the reason the round injected rather than for a duplicate path.
        directories: Array.from({ length: directoryCount }, (_, index) => ({
          name: hostile(next, HOSTILE_NAMES, `d${index}`),
          parentIndex: parentIndex(next, index, index),
        })),
        files: Array.from({ length: below(next, 5) }, (_, index) => {
          const size = hostile(next, HOSTILE_SIZES, 1 + below(next, 24));
          const declared = Math.ceil(Number(size) / Number(chunkSize));
          // Clamped, so a nonsensical size produces a manifest to refuse
          // rather than a chunk list too large to build.
          const count = Math.min(
            8,
            Math.max(0, Number.isSafeInteger(declared) ? declared : 1),
          );
          return {
            name: hostile(next, HOSTILE_NAMES, `f${index}.dat`),
            size,
            chunkHashes: Array.from({ length: hostile(next, [count + 1, 0], count) }, () =>
              randomHash(next, hostile(next, [31, 33, 0], pick(next, [32, 40, 64])))),
            parentIndex: parentIndex(next, index, directoryCount),
          };
        }),
      };

      let manifest: Manifest;
      try {
        manifest = new Manifest(raw);
      } catch (error) {
        assert.ok(error instanceof AppError, `round ${round} refused with a foreign error`);
        continue;
      }

      accepted += 1;
      assert.equal(Object.getPrototypeOf(manifest.files), null, `round ${round}`);
      for (const [path, entry] of Object.entries(manifest.files)) {
        paths += 1;
        const segments = path.split("/");
        assert.ok(segments.length > 0 && segments.every((segment) =>
          segment.length > 0
          && segment.length <= 255
          && segment !== "."
          && segment !== ".."
          && !segment.includes("\0")
          && !segment.includes("\\")), `round ${round}: ${JSON.stringify(path)}`);
        assert.equal(
          entry.chunkHashes.length,
          Math.ceil(entry.size / manifest.chunkSize),
          `round ${round}: ${path}`,
        );
        for (const hash of entry.chunkHashes) {
          assert.equal(hash, hash.toLowerCase(), `round ${round}: ${path}`);
          assert.ok(HASH_ALGOS[hash.length], `round ${round}: ${path}`);
        }
      }
    }
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), untouched);
    // The generator is the part that rots. Without this, weighting it a little
    // further toward hostile input would turn the whole round into a refusal
    // check and nothing above it would ever run again.
    assert.ok(accepted > ROUNDS / 4, `only ${accepted} of ${ROUNDS} manifests parsed`);
    assert.ok(paths > ROUNDS / 4, `only ${paths} paths were produced`);
  });
});

describe("the WebAssembly section walk against generated input", () => {
  function randomModule(next: () => number): Uint8Array {
    const sections = Array.from({ length: 1 + below(next, 6) }, () =>
      encodeSection({
        id: below(next, 13),
        body: randomBytes(next, below(next, 40)),
      }));
    return concat(WASM_HEADER, ...sections);
  }

  it("re-encodes what it split, byte for byte", () => {
    const next = stream(0x7f80_91a2);
    for (let round = 0; round < ROUNDS; round += 1) {
      const module = randomModule(next);
      const sections = splitSections(module);
      assert.deepEqual(
        concat(WASM_HEADER, ...sections.map(encodeSection)),
        module,
        `round ${round}`,
      );
    }
  });

  it("round-trips index vectors and code bodies", () => {
    const next = stream(0x8091_a2b3);
    for (let round = 0; round < ROUNDS; round += 1) {
      const indices = Array.from({ length: below(next, 12) }, () =>
        below(next, 0x1_0000_0000));
      assert.deepEqual(
        parseIndexVector(encodeIndexVector(indices)),
        indices,
        `round ${round}`,
      );

      const bodies = Array.from({ length: below(next, 6) }, () =>
        randomBytes(next, below(next, 24)));
      assert.deepEqual(parseCode(encodeCode(bodies)), bodies, `round ${round}`);
    }
  });

  it("refuses a corrupted module as a structural fault, never as a surprise", () => {
    const next = stream(0x91a2_b3c4);
    const parsers = [splitSections, parseTypes, parseIndexVector, parseCode];
    for (let round = 0; round < ROUNDS; round += 1) {
      const module = randomModule(next);
      const at = below(next, module.byteLength);
      const corrupted = Uint8Array.from(module);
      corrupted[at] = (corrupted[at]! + 1 + below(next, 255)) & 0xff;

      for (const parse of parsers) {
        try {
          parse(corrupted);
        } catch (error) {
          assert.ok(error instanceof Error, `round ${round}: ${parse.name}`);
          assert.match(error.message, /^wasm: /u, `round ${round}: ${parse.name}`);
        }
      }

      const noise = randomBytes(next, below(next, 64));
      for (const parse of parsers) {
        try {
          parse(noise);
        } catch (error) {
          assert.ok(error instanceof Error, `round ${round}: ${parse.name}`);
          assert.match(error.message, /^wasm: /u, `round ${round}: ${parse.name}`);
        }
      }
    }
  });
});
