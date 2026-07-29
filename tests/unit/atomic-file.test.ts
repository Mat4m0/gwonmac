import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  sweepOrphanDirectories,
  sweepOrphans,
  writeAll,
  writeAtomic,
  writeAtomicInDir,
  writeAtomicJson,
  windowsReplaceRetryDelay,
} from "../../src/main/core/atomic-file.js";
import { appPaths, documentDirectories } from "../../src/main/core/paths.js";
import { terminateTestChild } from "../../scripts/electron-layout.js";

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
    if (process.platform !== "win32") {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
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
    assert.deepEqual(
      events,
      process.platform === "win32"
        ? ["file:before-rename"]
        : ["file:before-rename", "dir:after-rename"],
    );
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

describe("atomic-file Windows replacement policy", () => {
  it("retries only bounded sharing and antivirus-shaped failures", () => {
    for (const code of ["EACCES", "EBUSY", "EPERM"]) {
      assert.deepEqual(
        Array.from(
          { length: 6 },
          (_, attempt) => windowsReplaceRetryDelay({ code }, attempt),
        ),
        [10, 25, 50, 100, 200, null],
      );
    }
    for (const code of ["EEXIST", "ENOENT", "ENOSPC", "UNKNOWN"]) {
      assert.equal(windowsReplaceRetryDelay({ code }, 0), null);
    }
    assert.equal(windowsReplaceRetryDelay(new Error("foreign"), 0), null);
    assert.equal(windowsReplaceRetryDelay({ code: "EPERM" }, -1), null);
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

  it("sweeps an orphan from a force-terminated writer, with the old document intact", async () => {
    const dir = await scratch();
    const target = join(dir, "doc.json");
    const ready = join(dir, "writer.ready");
    await writeAtomic(target, '{"kept":true}');

    // A real process, really killed between the temp write and the rename.
    // Every other case here hand-writes the artefact of a crash and so pins
    // the temp-file naming to itself; this one reads it off the disk a dead
    // writer left, which is what couples `writeAtomic` to `sweepOrphans`.
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(
          fileURLToPath(new URL("../../scripts/ts-hook.mjs", import.meta.url)),
        ).href,
        "--experimental-strip-types",
        fileURLToPath(new URL("../fixtures/pause-mid-atomic-write.ts", import.meta.url)),
        target,
        ready,
      ],
      { stdio: "ignore" },
    );
    const deadline = Date.now() + 10_000;
    while (!existsSync(ready) && Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(existsSync(ready), true, "the writer never reached the barrier");
    await terminateTestChild(child);
    assert.ok(child.exitCode !== null || child.signalCode !== null);

    const abandoned = (await readdir(dir)).filter(
      (name) => name !== "doc.json" && name !== "writer.ready",
    );
    assert.equal(abandoned.length, 1, `expected one orphan, saw ${abandoned.join(", ")}`);
    assert.match(abandoned[0]!, /^doc\.json\.\d+\.[0-9a-f]{8}\.tmp$/);
    // The half-written replacement never became the document.
    assert.equal(await readFile(target, "utf8"), '{"kept":true}');

    assert.equal(await sweepOrphans(dir), 1);
    assert.deepEqual((await readdir(dir)).sort(), ["doc.json", "writer.ready"]);
    assert.equal(await readFile(target, "utf8"), '{"kept":true}');
  });

  it("reports zero for a directory that does not exist", async () => {
    assert.equal(await sweepOrphans(join(await scratch(), "absent")), 0);
  });

  it("reaches every directory the profile publishes documents into", async () => {
    // The sweep used to run in one place, on the chunk directory, during an
    // update. settings.json, window-state.json, the generation directories and
    // the diagnostics log all publish through the same `writeAtomic` and so
    // leak the same temp files — they were collected by nothing at all.
    const root = await scratch();
    const dirs = documentDirectories(appPaths(root));
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `doc.json.${process.pid + 1}.0badcafe.tmp`), "abandoned");
      await writeFile(join(dir, `doc.json.${process.pid}.0badcafe.tmp`), "still ours");
    }

    assert.equal(await sweepOrphanDirectories(dirs), dirs.length);

    for (const dir of dirs) {
      const left = await readdir(dir);
      assert.deepEqual(
        left.filter((name) => name.endsWith(".tmp")),
        [`doc.json.${process.pid}.0badcafe.tmp`],
        `${dir} kept the wrong files`,
      );
    }
  });
});
