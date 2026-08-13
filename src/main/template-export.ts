/**
 * Putting the game's build templates on disk, where a player can keep, copy or
 * carry them.
 *
 * Owns: the destination dialog, naming a folder that replaces nothing, the
 * bounded write, and the check that every path the renderer sent stays inside
 * the chosen folder. That last one is not a formality — the renderer supplies
 * the tree because only it can see the mount, so this is the boundary where a
 * path stops being trusted.
 *
 * Refuses to parse, to know the game's filesystem, and to answer a path back to
 * the renderer: like `appRevealPath`, only main knows where the player pointed.
 */

import { dialog, type BrowserWindow } from "electron";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  type TemplateExportEntry,
  type TemplateExportResult,
} from "../shared/contracts.js";
import { AppError, type ErrorCode } from "../shared/errors.js";
import { parseTemplateEntries } from "../shared/template-entries.js";

/** The folder an export creates. Numbered rather than merged, so nothing is replaced. */
const DESTINATION_NAME = "Guild Wars Build Templates";
const MAX_DESTINATIONS = 99;

/**
 * `Skills/<name>.txt` or `Skills/<folder>/<name>.txt` — two or three segments,
 * which is the deepest the client can key a template.
 */
/**
 * The rule the writer relies on, applied at the boundary rather than trusted.
 *
 * `credentialsSave` validates the same way: the code that consumes a value
 * re-checks it here so there is no second opinion about what is acceptable. A
 * path is rejected outright rather than repaired, because a repaired path is a
 * write the player never asked for.
 */
export function parseExportEntries(value: unknown): TemplateExportEntry[] {
  return parseTemplateEntries(value);
}

/**
 * A destination that exists already is never written into. The player asked to
 * export, not to merge with whatever an earlier export left behind, and a merge
 * is the one outcome they could not undo by deleting a folder.
 */
async function freshDestination(parent: string): Promise<string> {
  for (let suffix = 1; suffix <= MAX_DESTINATIONS; suffix += 1) {
    const name = suffix === 1 ? DESTINATION_NAME : `${DESTINATION_NAME} ${suffix}`;
    const candidate = path.join(parent, name);
    try {
      await mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new AppError("validation", `no unused destination in ${parent}`);
}

export async function exportTemplates(
  win: BrowserWindow,
  entries: readonly TemplateExportEntry[],
): Promise<TemplateExportResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Export Build Templates",
    message: "Choose where to put the exported build templates.",
    buttonLabel: "Export",
    properties: ["openDirectory", "createDirectory"],
  });
  const parent = filePaths[0];
  if (canceled || parent === undefined) return { status: "cancelled" };

  try {
    const destination = await freshDestination(parent);
    const created = new Set<string>();
    for (const entry of entries) {
      const target = path.join(destination, entry.path);
      const directory = path.dirname(target);
      if (!created.has(directory)) {
        await mkdir(directory, { recursive: true });
        created.add(directory);
      }
      // No trailing newline: the game writes none, and a file that gains one
      // stops being the file the client will read back.
      await writeFile(target, entry.contents, { encoding: "utf8" });
    }
    return { status: "written", count: entries.length };
  } catch (error) {
    return { status: "failed", errorCode: exportErrorCode(error) };
  }
}

/**
 * A Node errno is an open set this process does not control, so only the one
 * condition a player can act on earns a name; everything else collapses to
 * `unknown` rather than widening the catalogue.
 */
function exportErrorCode(error: unknown): ErrorCode {
  if (error instanceof AppError) return error.code;
  const errno = (error as NodeJS.ErrnoException | null)?.code;
  return errno === "ENOSPC" || errno === "EDQUOT" ? "disk_full" : "unknown";
}
