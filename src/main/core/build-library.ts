/**
 * The durable half of the hero-builds toolbox: read and write `build-library.json`.
 *
 * The shape lives in `src/shared/builds/library.ts` because the renderer needs
 * it too. What lives here is everything that touches a disk, and one decision
 * that shapes the whole feature:
 *
 * **The library is the source of truth. The game's template folder is a
 * projection of it, written on demand.**
 *
 * The alternative — treating `app:/Templates/Skills` as the library and reading
 * it back — gives two writers to one directory, and the other writer is the
 * game, which this project does not control. `AGENTS.md` asks for one owner per
 * concept before anything else; this is that answer for builds.
 *
 * ## Why this is stricter than `settings.ts` in one place and softer in another
 *
 * Stricter: duplicate ids throw. `buildById` returns the first match, so a file
 * with two builds sharing an id silently loses one of them and rebinds every
 * team that pointed at it. That is data loss disguised as a successful load.
 *
 * Softer: a team slot naming a build that is not in the file is repaired to
 * `null` rather than refused. `TeamSlot.build` is already nullable — an empty
 * slot is an ordinary state — and deleting a build does exactly this repair to
 * every slot that held it. Refusing instead would mean one dangling reference
 * costs a player their entire collection, which is a far worse answer than one
 * empty slot in one team.
 *
 * ## Why a corrupt library is louder than corrupt settings
 *
 * `loadSettings` recovers by returning defaults, and defaults are a perfectly
 * good place to be. There is no such thing as a good default library: an empty
 * one is a player's whole collection gone. So the file is moved aside intact
 * and `onRecovered` fires — the caller is expected to tell somebody, not to
 * treat the empty result as normal.
 */
import { readFile } from "node:fs/promises";
import type { BuildId, BuildLibrary } from "../../shared/builds/library.js";
import {
  EMPTY_LIBRARY,
  parseBuildLibrary,
} from "../../shared/builds/parse-library.js";
import { writeAtomicJson, writeAtomicJsonExclusive } from "./atomic-file.js";
import { quarantineCorruptDocument } from "./corrupt-document.js";

/** Owner-only: a build library is a player's own work, not shared state. */
const LIBRARY_MODE = 0o600;

export async function loadBuildLibrary(
  path: string,
  onRecovered?: (backupPath: string) => void | Promise<void>,
): Promise<BuildLibrary> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return EMPTY_LIBRARY;
    throw e;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return recoverCorruptLibrary(path, onRecovered);
  }
  try {
    return parseBuildLibrary(raw);
  } catch {
    return recoverCorruptLibrary(path, onRecovered);
  }
}

/**
 * Move the unreadable file aside and start empty. The rename is what makes this
 * survivable: an empty library is not a default, it is the player's collection
 * missing, and the backup is the only copy left.
 */
async function recoverCorruptLibrary(
  path: string,
  onRecovered: ((backupPath: string) => void | Promise<void>) | undefined,
): Promise<BuildLibrary> {
  const backupPath = await quarantineCorruptDocument(path);
  if (backupPath) await onRecovered?.(backupPath);
  return EMPTY_LIBRARY;
}

/**
 * Write the library and return what was actually stored. The parse on the way
 * in is not ceremony: it is what stops a renderer bug from persisting a shape
 * the next launch would have to quarantine, and it applies the same dangling
 * reference repair, so what the caller gets back is what a reload would give.
 */
export async function saveBuildLibrary(
  path: string,
  value: BuildLibrary,
): Promise<BuildLibrary> {
  const cleaned = parseBuildLibrary(value);
  await writeAtomicJson(path, cleaned, LIBRARY_MODE);
  return cleaned;
}

/** First-account import: publish a complete library without replacing recovery data. */
export async function saveBuildLibraryExclusive(
  path: string,
  value: BuildLibrary,
): Promise<BuildLibrary> {
  const cleaned = parseBuildLibrary(value);
  await writeAtomicJsonExclusive(path, cleaned, LIBRARY_MODE);
  return cleaned;
}

/** Every build id a slot points at. The renderer's "used in N teams" runs on this. */
export function referencedBuildIds(library: BuildLibrary): ReadonlySet<BuildId> {
  const used = new Set<BuildId>();
  for (const team of library.teams) {
    for (const slot of team.slots) if (slot.build !== null) used.add(slot.build);
  }
  return used;
}
