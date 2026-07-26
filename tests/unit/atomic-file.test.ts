import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sweepOrphans,
  writeAll,
  writeAtomic,
  writeAtomicInDir,
  writeAtomicJson,
} from "../../src/main/core/atomic-file.js";

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "gw-atomic-"));
}

/** A sink that never consumes more than `limit` bytes per call, like a real short write. */
function shortWriteSink(limit: number): {
  write: (
    data: Uint8Array,
    offset: number,
    length: number,
  ) => Promise<{ bytesWritten: number }>;
  written: number[];
  calls: number;
} {
  const sink = {
    written: [] as number[],
    calls: 0,
    write: async (data: Uint8Array, offset: number, length: number) => {
      sink.calls += 1;
      const bytesWritten = Math.min(limit, length);
      for (let i = 0; i < bytesWritten; i++) sink.written.push(data[offset + i]!);
      return { bytesWritten };
    },
  };
  return sink;
}

/**
 * Record every `FileHandle.sync()` the code under test performs, with whether
 * the handle is a directory and whether `target` exists at that moment. That is
 * enough to prove ordering: contents are synced while only the temp file
 * exists, the directory is synced once the target is in place.
 */
async function recordSyncs(
  target: string,
  run: () => Promise<void>,
): Promise<string[]> {
  const probe = await open(join(await scratch(), "probe"), "w");
  const proto = Object.getPrototypeOf(probe) as {
    sync: (this: FileHandle) => Promise<void>;
  };
  await probe.close();
  const original = proto.sync;
  const events: string[] = [];
  proto.sync = async function spy(this: FileHandle): Promise<void> {
    const kind = (await this.stat()).isDirectory() ? "dir" : "file";
    events.push(`${kind}:${existsSync(target) ? "after-rename" : "before-rename"}`);
    return original.call(this);
  };
  try {
    await run();
  } finally {
    proto.sync = original;
  }
  return events;
}

describe("atomic-file", () => {
  it("replaces the target only after a complete write", async () => {
    const dir = await scratch();
    const path = join(dir, "out.txt");
    await writeFile(path, "old");
    await writeAtomic(path, "new-contents");
    assert.equal(await readFile(path, "utf8"), "new-contents");
  });

  it("writes JSON atomically", async () => {
    const dir = await scratch();
    const path = join(dir, "meta.json");
    await writeAtomicJson(path, { a: 1, b: "x" });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { a: 1, b: "x" });
  });

  it("creates parent directories", async () => {
    const dir = await scratch();
    const path = join(dir, "nested", "deep", "f.bin");
    await writeAtomic(path, new Uint8Array([1, 2, 3]));
    assert.deepEqual(Uint8Array.from(await readFile(path)), new Uint8Array([1, 2, 3]));
  });

  it("applies the requested mode to the published file", async () => {
    const dir = await scratch();
    const path = join(dir, "secret.bin");
    await writeAtomic(path, new Uint8Array([9]), 0o600);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  });

  it("writes large payloads through writeAtomicInDir", async () => {
    const dir = await scratch();
    const data = new Uint8Array(512 * 1024).map((_, i) => i & 0xff);
    await writeAtomicInDir(join(dir, "chunks"), "abc123", data);
    const written = await readFile(join(dir, "chunks", "abc123"));
    assert.equal(written.byteLength, data.byteLength);
    assert.deepEqual(Uint8Array.from(written), data);
  });
});

describe("atomic-file writeAll", () => {
  it("keeps writing until the buffer is consumed", async () => {
    const sink = shortWriteSink(3);
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await writeAll(sink, data);
    assert.deepEqual(Uint8Array.from(sink.written), data);
    assert.equal(sink.calls, 3);
  });

  it("resumes from the offset the sink reached, not from zero", async () => {
    const seen: { offset: number; length: number }[] = [];
    const data = new Uint8Array([10, 20, 30, 40, 50]);
    await writeAll(
      {
        write: async (_data, offset, length) => {
          seen.push({ offset, length });
          return { bytesWritten: 2 };
        },
      },
      data,
    );
    assert.deepEqual(seen, [
      { offset: 0, length: 5 },
      { offset: 2, length: 3 },
      { offset: 4, length: 1 },
    ]);
  });

  it("fails loudly when the sink stops making progress", async () => {
    await assert.rejects(
      writeAll({ write: async () => ({ bytesWritten: 0 }) }, new Uint8Array([1, 2])),
      (error: unknown) =>
        error instanceof Error &&
        (error as { code?: string }).code === "short_write" &&
        /0\/2 bytes/.test(error.message),
    );
  });

  it("writes every byte to a real file handle", async () => {
    const dir = await scratch();
    const path = join(dir, "big.bin");
    const data = new Uint8Array(300_000).map((_, i) => (i * 7) & 0xff);
    const handle = await open(path, "w");
    try {
      await writeAll(handle, data);
    } finally {
      await handle.close();
    }
    assert.deepEqual(Uint8Array.from(await readFile(path)), data);
  });
});

describe("atomic-file durability", () => {
  it("syncs the temp file before the rename and the directory after it", async () => {
    const dir = await scratch();
    const target = join(dir, "durable.bin");
    const events = await recordSyncs(target, () =>
      writeAtomic(target, new Uint8Array([1, 2, 3])),
    );
    assert.deepEqual(events, ["file:before-rename", "dir:after-rename"]);
  });

  it("leaves no temp file behind when the rename fails", async () => {
    const dir = await scratch();
    // Renaming a file over a non-empty directory fails; the target must survive.
    const target = join(dir, "occupied");
    await mkdir(target);
    await writeFile(join(target, "kept"), "intact");

    await assert.rejects(writeAtomic(target, new Uint8Array([1, 2, 3])));

    assert.deepEqual(await readdir(dir), ["occupied"]);
    assert.equal(await readFile(join(target, "kept"), "utf8"), "intact");
  });
});

describe("atomic-file orphan sweep", () => {
  it("removes temp files left by dead processes and keeps everything else", async () => {
    const dir = await scratch();
    const abandoned = `chunkhash.${process.pid + 1}.0badcafe.tmp`;
    const ours = `chunkhash.${process.pid}.deadbeef.tmp`;
    await writeFile(join(dir, abandoned), "partial");
    await writeFile(join(dir, ours), "in flight");
    await writeFile(join(dir, "chunkhash"), "real chunk");
    await writeFile(join(dir, "boot-chunks.json"), "{}");

    assert.equal(await sweepOrphans(dir), 1);
    assert.deepEqual((await readdir(dir)).sort(), [
      "boot-chunks.json",
      "chunkhash",
      ours,
    ].sort());
  });

  it("sweeps a temp file a crashed writer really left behind", async () => {
    const dir = await scratch();
    const target = join(dir, "doc.json");
    await writeAtomic(target, "{}");
    // Same shape writeAtomic produces, but owned by a process that is gone.
    const orphan = join(dir, `doc.json.${process.pid + 2}.abcdef01.tmp`);
    await writeFile(orphan, "half a document");

    assert.equal(await sweepOrphans(dir), 1);
    assert.equal(existsSync(orphan), false);
    assert.equal(await readFile(target, "utf8"), "{}");
  });

  it("reports zero for a directory that does not exist", async () => {
    assert.equal(await sweepOrphans(join(await scratch(), "absent")), 0);
  });
});
