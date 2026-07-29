import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  readDiagnosticZip,
  writeDiagnosticZip,
} from "../../src/main/core/diagnostic-zip.js";

const scratch = () => mkdtemp(path.join(tmpdir(), "gw-diagnostic-zip-"));
const text = new TextEncoder();

async function archive(
  entries: readonly {
    name: string;
    body: string;
    unixMode?: number;
  }[],
): Promise<Uint8Array> {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, {
    level: 0,
    useCompressionStream: false,
    useWebWorkers: false,
  });
  for (const entry of entries) {
    await writer.add(entry.name, new Uint8ArrayReader(text.encode(entry.body)), {
      level: 0,
      ...(entry.unixMode === undefined ? {} : { unixMode: entry.unixMode }),
      useCompressionStream: false,
      useWebWorkers: false,
    });
  }
  return writer.close();
}

function replaceAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  assert.equal(from.length, to.length);
  const copy = Uint8Array.from(bytes);
  const source = text.encode(from);
  const replacement = text.encode(to);
  for (let offset = 0; offset <= copy.length - source.length; offset += 1) {
    if (source.every((value, index) => copy[offset + index] === value)) {
      copy.set(replacement, offset);
    }
  }
  return copy;
}

function findSignature(bytes: Uint8Array, signature: number): number {
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    const value =
      bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24);
    if ((value >>> 0) === signature) return offset;
  }
  throw new Error(`ZIP signature ${signature.toString(16)} is missing`);
}

async function refusal(bytes: Uint8Array, pattern: RegExp): Promise<void> {
  const root = await scratch();
  const source = path.join(root, "capture.gwdiag");
  const extracted = path.join(root, "extracted");
  await writeFile(source, bytes);
  await assert.rejects(readDiagnosticZip(source, extracted), pattern);
}

describe("portable diagnostic ZIP", () => {
  it("streams the closed report inventory in both directions", async () => {
    const root = await scratch();
    const source = path.join(root, "source");
    const output = path.join(root, "capture.gwdiag");
    const extracted = path.join(root, "extracted");
    await mkdir(source);
    await writeFile(path.join(source, "manifest.json"), '{"formatVersion":2}');
    await writeFile(path.join(source, "events.jsonl"), '{"name":"one"}\n');
    await writeFile(
      path.join(source, "frames.bin"),
      new Uint8Array(2 * 1024 * 1024).fill(0x5a),
    );

    await writeDiagnosticZip(source, output);
    await readDiagnosticZip(output, extracted);

    for (const name of ["events.jsonl", "frames.bin", "manifest.json"]) {
      assert.deepEqual(
        await readFile(path.join(extracted, name)),
        await readFile(path.join(source, name)),
      );
    }
  });

  it("rejects traversal, absolute paths, unknown files, and links", async () => {
    for (const [name, pattern] of [
      ["../report.json", /unknown entry|unsafe/],
      ["/report.json", /unknown entry|unsafe/],
      ["surprise.txt", /unknown entry/],
    ] as const) {
      await refusal(await archive([{ name, body: "x" }]), pattern);
    }
    await refusal(
      await archive([
        { name: "report.json", body: "x", unixMode: 0o120777 },
      ]),
      /links and special files/,
    );
  });

  it("rejects duplicate entries and unsupported compression", async () => {
    const two = await archive([
      { name: "events.jsonl", body: "one" },
      { name: "summary.json", body: "two" },
    ]);
    await refusal(
      replaceAscii(two, "summary.json", "events.jsonl"),
      /duplicate entry|Ambiguous archive/,
    );

    const unsupported = Uint8Array.from(
      await archive([{ name: "events.jsonl", body: "content" }]),
    );
    const local = findSignature(unsupported, 0x04034b50);
    const central = findSignature(unsupported, 0x02014b50);
    unsupported[local + 8] = 99;
    unsupported[local + 9] = 0;
    unsupported[central + 10] = 99;
    unsupported[central + 11] = 0;
    await refusal(unsupported, /compression method|Compression method/);
  });

  it("rejects bomb-sized metadata, truncation, and CRC failure", async () => {
    const oversized = Uint8Array.from(
      await archive([{ name: "events.jsonl", body: "content" }]),
    );
    const local = findSignature(oversized, 0x04034b50);
    const central = findSignature(oversized, 0x02014b50);
    for (const offset of [local + 22, central + 24]) {
      oversized.set([0xff, 0xff, 0xff, 0x7f], offset);
    }
    await refusal(oversized, /size exceeds|Invalid uncompressed size/);

    const valid = await archive([{ name: "events.jsonl", body: "content" }]);
    await refusal(valid.subarray(0, valid.length - 8), /central|signature|ZIP/i);

    const corrupt = Uint8Array.from(valid);
    const nameLength = corrupt[local + 26]! | (corrupt[local + 27]! << 8);
    const extraLength = corrupt[local + 28]! | (corrupt[local + 29]! << 8);
    const dataOffset = local + 30 + nameLength + extraLength;
    corrupt[dataOffset] = corrupt[dataOffset]! ^ 0xff;
    await refusal(corrupt, /signature|CRC|compressed data/i);
  });
});
