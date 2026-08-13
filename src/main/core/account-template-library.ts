/**
 * The canonical Multiple Accounts template library and its three-way merge.
 *
 * Each shared profile receives a checkpoint at launch. On close, its current
 * projection is compared with that checkpoint and the latest canonical
 * library. Unrelated edits combine; a concurrent edit beats a stale deletion;
 * and two different edits to one path are both retained under stable conflict
 * names. Single Account data never enters this owner except as an explicit
 * setup snapshot.
 */
import { readFile } from "node:fs/promises";
import type {
  AccountTemplateLibrary,
  TemplateExportEntry,
} from "../../shared/contracts.js";
import { AppError } from "../../shared/errors.js";
import { parseTemplateEntries } from "../../shared/template-entries.js";
import { writeAtomicJson } from "./atomic-file.js";

const DOCUMENT_MODE = 0o600;

function parseLibrary(value: unknown): AccountTemplateLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("bad_multi_workspace", "template library must be an object");
  }
  const source = value as Record<string, unknown>;
  if (
    source.formatVersion !== 1
    || !Number.isSafeInteger(source.revision)
    || (source.revision as number) < 0
  ) {
    throw new AppError("bad_multi_workspace", "template library format is invalid");
  }
  return {
    revision: source.revision as number,
    entries: parseTemplateEntries(source.entries),
  };
}

export async function loadAccountTemplateLibrary(
  filePath: string,
): Promise<AccountTemplateLibrary> {
  try {
    return parseLibrary(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { revision: 0, entries: [] };
    }
    throw error;
  }
}

export async function saveAccountTemplateLibrary(
  filePath: string,
  library: AccountTemplateLibrary,
): Promise<AccountTemplateLibrary> {
  const entries = parseTemplateEntries(library.entries);
  const value = { formatVersion: 1, revision: library.revision, entries };
  await writeAtomicJson(filePath, value, DOCUMENT_MODE);
  return { revision: value.revision, entries: value.entries };
}

const pathKey = (filePath: string) => filePath.normalize("NFC").toLowerCase();
const entriesByPath = (entries: readonly TemplateExportEntry[]) =>
  new Map(entries.map((entry) => [pathKey(entry.path), entry]));

function conflictPath(path: string, occupied: ReadonlySet<string>): string {
  const suffix = " (conflict)";
  const extension = path.toLowerCase().endsWith(".txt") ? ".txt" : "";
  const cut = path.lastIndexOf("/");
  const directory = path.slice(0, cut + 1);
  const file = path.slice(cut + 1, extension ? -extension.length : undefined);
  for (let number = 1; number <= 99; number += 1) {
    const tag = `${suffix}${number === 1 ? "" : ` ${number}`}`;
    const maxStem = 259 - extension.length - tag.length;
    const candidate = `${directory}${file.slice(0, maxStem)}${tag}${extension}`;
    if (!occupied.has(pathKey(candidate))) return candidate;
  }
  throw new AppError("bad_multi_workspace", "too many template conflicts");
}

/** Merge one profile projection against the checkpoint it was launched with. */
export function reconcileAccountTemplates(
  baseEntries: readonly TemplateExportEntry[],
  latestEntries: readonly TemplateExportEntry[],
  profileEntries: readonly TemplateExportEntry[],
): TemplateExportEntry[] {
  const base = entriesByPath(parseTemplateEntries(baseEntries));
  const latest = entriesByPath(parseTemplateEntries(latestEntries));
  const profile = entriesByPath(parseTemplateEntries(profileEntries));
  const result = new Map(latest);
  const paths = new Set([...base.keys(), ...profile.keys()]);
  for (const key of paths) {
    const before = base.get(key);
    const local = profile.get(key);
    const current = latest.get(key);
    if (local?.contents === before?.contents) continue;
    if (local === undefined) {
      if (current?.contents === before?.contents) result.delete(key);
      continue;
    }
    if (
      current === undefined
      || current.contents === before?.contents
      || current.contents === local.contents
    ) {
      result.set(key, local);
      continue;
    }
    const occupied = new Set(result.keys());
    const conflicted = conflictPath(local.path, occupied);
    result.set(pathKey(conflicted), { path: conflicted, contents: local.contents });
  }
  return [...result.values()]
    .sort((left, right) => left.path.localeCompare(right.path));
}
