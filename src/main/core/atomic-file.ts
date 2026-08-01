/**
 * The only way this process replaces a file whose half-written state a reader
 * could otherwise observe: temp file, fsync, rename, fsync the directory.
 *
 * Nothing here overwrites in place and nothing here is best-effort. A failed
 * write unlinks its own temp file and rethrows, so the target keeps its previous
 * contents rather than acquiring part of the new ones. Temp names carry the
 * writing pid, which is what lets the sweep tell a dead process's debris from a
 * live process's in-flight write; no other code collects them, because chunk
 * pruning deliberately ignores names that are not content hashes.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "../../shared/errors.js";

/**
 * `<target>.<pid>.<8 hex>.tmp`. The pid is part of the name so a sweep can tell
 * a temp file abandoned by a dead process from one a live process still owns.
 */
const TEMP_NAME = /\.(\d+)\.[0-9a-f]{8}\.tmp$/;

function tempPath(target: string): string {
  const suffix = randomBytes(4).toString("hex");
  return `${target}.${process.pid}.${suffix}.tmp`;
}

/** The one `FileHandle` method `writeAll` needs. */
export interface ByteSink {
  write(
    data: Uint8Array,
    offset: number,
    length: number,
  ): Promise<{ bytesWritten: number }>;
}

/**
 * Write every byte. A single `write()` is not guaranteed to consume the whole
 * buffer — a nearly full volume or an interrupted syscall returns early — so a
 * caller that discards `bytesWritten` silently truncates the file and then
 * durably commits the truncation.
 */
export async function writeAll(handle: ByteSink, data: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(
      data,
      offset,
      data.byteLength - offset,
    );
    if (bytesWritten <= 0) {
      throw new AppError(
        "short_write",
        `wrote ${offset}/${data.byteLength} bytes`,
      );
    }
    offset += bytesWritten;
  }
}

/**
 * fsync a directory, so the rename that created an entry in it survives a
 * crash. Without this the file contents are durable but the name is not.
 *
 * Limitation: on macOS `fsync(2)` reaches the drive but does not force the
 * drive to flush its own write cache — that needs `F_FULLFSYNC`, which Node
 * does not expose. This is correct against process and OS crashes, which is the
 * failure mode we face; it is not a claim about sudden power loss.
 */
async function syncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeAtomic(
  path: string,
  data: string | Uint8Array,
  mode?: number,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = tempPath(path);
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  try {
    // `wx` so a name collision fails instead of overwriting another writer.
    const handle = await open(tmp, "wx", mode);
    try {
      await writeAll(handle, bytes);
      // The creation mode is masked by umask; chmod is not.
      if (mode !== undefined) await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
    await syncDirectory(dir);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function writeAtomicJson(
  path: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  await writeAtomic(path, JSON.stringify(value), mode);
}

/** Chunk publication: write under a unique temp name in the same directory, then rename. */
export async function writeAtomicInDir(
  dir: string,
  finalName: string,
  data: Uint8Array,
): Promise<void> {
  await writeAtomic(join(dir, finalName), data);
}

/**
 * Collect temp files abandoned by a process that died between write and rename.
 * Nothing else collects them: `pruneUnreferencedChunks` deliberately ignores
 * non-hash filenames.
 *
 * Temp files carrying this process's pid are left alone — an in-flight write in
 * this process owns its temp file and removes it itself on failure.
 */
export async function sweepOrphanDirectories(
  dirs: readonly string[],
): Promise<number> {
  let removed = 0;
  for (const dir of dirs) removed += await sweepOrphans(dir);
  return removed;
}

export async function sweepOrphans(dir: string): Promise<number> {
  const entries = await readdir(dir).catch((): string[] => []);
  let removed = 0;
  for (const name of entries) {
    const owner = TEMP_NAME.exec(name)?.[1];
    if (owner === undefined || Number(owner) === process.pid) continue;
    const gone = await unlink(join(dir, name)).then(
      () => true,
      () => false,
    );
    if (gone) removed += 1;
  }
  return removed;
}
