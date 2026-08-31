/**
 * Preserve one unreadable player document and bound only the backups this
 * helper owns. Domain loaders still decide their defaults and notifications.
 */
import { randomUUID } from "node:crypto";
import { readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeAtomicExclusive } from "./atomic-file.js";

const CORRUPT_BACKUPS_KEPT = 3;

function backupTimestamp(name: string, prefix: string): number | null {
  const suffix = name.slice(prefix.length);
  const match = /^(\d+)(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/u
    .exec(suffix);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

async function pruneCorruptBackups(
  documentPath: string,
  preservedBackup: string,
): Promise<void> {
  const directory = dirname(documentPath);
  const prefix = `${basename(documentPath)}.corrupt-`;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  const preservedName = basename(preservedBackup);
  const backups = names
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, timestamp: backupTimestamp(name, prefix) }))
    .filter(
      (entry): entry is { name: string; timestamp: number } =>
        entry.timestamp !== null,
    )
    .sort((left, right) =>
      right.timestamp - left.timestamp || right.name.localeCompare(left.name));
  const keep = new Set([
    preservedName,
    ...backups
      .filter(({ name }) => name !== preservedName)
      .slice(0, CORRUPT_BACKUPS_KEPT - 1)
      .map(({ name }) => name),
  ]);
  await Promise.all(
    backups
      .filter(({ name }) => !keep.has(name))
      .map(({ name }) => unlink(join(directory, name)).catch(() => undefined)),
  );
}

/** Move an existing document aside without replacing earlier recovery data. */
export async function quarantineCorruptDocument(
  documentPath: string,
): Promise<string | null> {
  const backupPath = `${documentPath}.corrupt-${Date.now()}-${randomUUID()}`;
  try {
    await rename(documentPath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  await pruneCorruptBackups(documentPath, backupPath);
  return backupPath;
}

/**
 * Preserve bytes without first removing the source document. Recovery owners
 * use this when an absent source has different semantics from a corrupt one:
 * a crash between preservation and replacement must leave the corrupt source
 * available for the next retry, never look like a first launch.
 */
export async function preserveCorruptDocument(
  documentPath: string,
  bytes: string | Uint8Array,
  mode = 0o600,
): Promise<string> {
  const backupPath = `${documentPath}.corrupt-${Date.now()}-${randomUUID()}`;
  await writeAtomicExclusive(backupPath, bytes, mode);
  await pruneCorruptBackups(documentPath, backupPath);
  return backupPath;
}
