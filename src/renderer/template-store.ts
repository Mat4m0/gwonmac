/**
 * The game's mounted template directories: what is in them, what may be added,
 * and the one synchronisation that makes an addition durable.
 *
 * Owns: finding the mount at all, reading it into candidates, deciding what an
 * import may write against what is already there, the write itself, and the
 * refusal of any path that would leave the two directories.
 *
 * Refuses dialogs, disk, the text format, and the DOM. It is handed candidates
 * and hands back plans and counts; the sentences a player reads belong to
 * `template-pane.ts` and the format rules to `template-format.ts`.
 */

import type { TemplateExportEntry } from '../shared/contracts.js';
import {
  type TemplateCandidate,
  type TemplateKind,
  isTemplateCode,
  sanitiseTemplateName,
  templateRelativePath,
} from './template-format.js';

/**
 * The two directories `filesystem.ts` creates in `preRun`. They are spelled
 * again here because that module is merged wholesale into the WASM host and may
 * export nothing but its installer; a unit test compares the two spellings so
 * drift is a build failure rather than templates that stop being found.
 *
 * Absolute, with the leading slash `filesystem.ts` does not need. It mounts at
 * `app:` while the working directory is still the root and only then calls
 * `chdir(MOUNT)`, so its own mount-relative spelling resolves correctly and the
 * same string used from here — any time after startup — would resolve against
 * `/app:` and look for `/app:/app:/Templates/…`. Everything below addresses the
 * mount absolutely so no later `chdir`, by this code or by the client, can move
 * where a template is read or written.
 */
const TEMPLATE_DIRECTORIES: Readonly<Record<TemplateKind, string>> = {
  skills: '/app:/Templates/Skills',
  equipment: '/app:/Templates/Equipment',
};

/**
 * The game's own hard limit on templates directly inside a type directory.
 * Subfolders are the documented way around it, so fullness is only ever a
 * reason to refuse a write at the root.
 */
export const ROOT_LIMIT = 550;

const EXTENSION = '.txt';

/**
 * The mount, as the generated glue publishes it. The boundary is named as the
 * global object plus the property the runtime adds rather than widened to
 * `any`, the same way `template-save-compatibility.ts` names it.
 */
export interface TemplateFileSystem {
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  isFile(mode: number): boolean;
  readFile(path: string, options: { encoding: 'utf8' }): string;
  writeFile(path: string, data: string): void;
  mkdirTree(path: string): void;
  unlink(path: string): void;
  rmdir(path: string): void;
  analyzePath(path: string): { exists: boolean };
  syncfs(populate: boolean, callback: (error?: unknown) => void): void;
}

/**
 * Whether there is a mount to work with, answered by asking it rather than by
 * inferring from client state.
 *
 * There is no session or progress signal that means "`FS` exists": the mount
 * happens in `Module.preRun`, which runs only once ArenaNet's glue has loaded,
 * and `phase: "ready"` means the main process has an active client — reading
 * more into it is the mistake AGENTS.md warns about. After an abort the page
 * survives with the client dead, so this is checked again at every use and not
 * cached.
 */
export function templateFilesystem(): TemplateFileSystem | null {
  const runtime = globalThis as typeof globalThis & { FS?: TemplateFileSystem };
  const fs = runtime.FS;
  if (!fs || typeof fs.readdir !== 'function') return null;
  try {
    return fs.analyzePath(TEMPLATE_DIRECTORIES.skills).exists ? fs : null;
  } catch {
    return null;
  }
}

/**
 * Refuse anything that could leave the two directories.
 *
 * The `normalize` `filesystem.ts` installs onto `FS` rewrites backslashes and
 * carries no traversal guard, so the mount does not defend itself:
 * `FS.mkdirTree('app:/Templates/Skills/../../x')` succeeds today. Names arrive
 * sanitised, and this re-checks them anyway at the one place that turns a name
 * into a write — the rule that has already cost two wrong rounds in
 * internal/upstream/investigation-log.md.
 */
function safeSegment(segment: string): boolean {
  return (
    segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('/')
    && !segment.includes('\\')
    && !segment.includes(':')
  );
}

/** The absolute path a candidate writes to, or null if it may not have one. */
export function templatePath(candidate: TemplateCandidate): string | null {
  const directory = TEMPLATE_DIRECTORIES[candidate.kind];
  if (directory === undefined) return null;
  const segments = candidate.folder === null
    ? [candidate.name]
    : [candidate.folder, candidate.name];
  if (!segments.every(safeSegment)) return null;
  return `${directory}/${segments.join('/')}${EXTENSION}`;
}

function listing(fs: TemplateFileSystem, directory: string): string[] {
  try {
    return fs.readdir(directory).filter((entry) => entry !== '.' && entry !== '..');
  } catch {
    return [];
  }
}

function isDirectory(fs: TemplateFileSystem, path: string): boolean {
  try {
    return fs.isDir(fs.stat(path).mode);
  } catch {
    return false;
  }
}

function readCode(fs: TemplateFileSystem, path: string): string | null {
  try {
    const contents = fs.readFile(path, { encoding: 'utf8' }).trim();
    return isTemplateCode(contents) ? contents : null;
  } catch {
    return null;
  }
}

/**
 * Every template the game currently holds. One level of subfolder, because that
 * is the deepest key the client can express; anything deeper it could not show
 * and this will not invent.
 */
export function readTemplates(fs: TemplateFileSystem): TemplateCandidate[] {
  const found: TemplateCandidate[] = [];
  for (const kind of ['skills', 'equipment'] as const) {
    const directory = TEMPLATE_DIRECTORIES[kind];
    for (const entry of listing(fs, directory)) {
      const path = `${directory}/${entry}`;
      if (isDirectory(fs, path)) {
        for (const child of listing(fs, path)) {
          collect(fs, found, kind, entry, child, `${path}/${child}`);
        }
      } else {
        collect(fs, found, kind, null, entry, path);
      }
    }
  }
  return found.sort((left, right) =>
    templateRelativePath(left).localeCompare(templateRelativePath(right)),
  );
}

function collect(
  fs: TemplateFileSystem,
  found: TemplateCandidate[],
  kind: TemplateKind,
  folder: string | null,
  entry: string,
  path: string,
): void {
  if (!entry.toLowerCase().endsWith(EXTENSION)) return;
  const code = readCode(fs, path);
  if (code === null) return;
  found.push({ kind, folder, name: entry.slice(0, -EXTENSION.length), code });
}

/** Everything the game holds, addressed the way an export folder addresses it. */
export function exportEntries(fs: TemplateFileSystem): TemplateExportEntry[] {
  return readTemplates(fs).map((candidate) => ({
    path: templateRelativePath(candidate),
    contents: candidate.code,
  }));
}

export type CollisionPolicy = 'skip' | 'replace';

export interface ImportPlan {
  writes: TemplateCandidate[];
  /** Already saved under that name, with the same code: nothing to do. */
  already: number;
  /** That name is taken by a different build. */
  taken: number;
  /** Replacing a different build under a name the player chose to overwrite. */
  replaced: number;
  /** Refused because the type root is at the game's own limit. */
  full: number;
  /** Refused because the name could not be turned into a path inside the mount. */
  unsafe: number;
}

/**
 * What an import would do, decided against what is already saved.
 *
 * Everything is decided here and nothing is written, so the player sees the
 * whole outcome before any of it happens. A template whose code already matches
 * is never a write under either policy: re-importing the same folder is
 * idempotent, and says so.
 */
export function planImport(
  fs: TemplateFileSystem,
  incoming: readonly TemplateCandidate[],
  policy: CollisionPolicy,
): ImportPlan {
  const plan: ImportPlan = {
    writes: [],
    already: 0,
    taken: 0,
    replaced: 0,
    full: 0,
    unsafe: 0,
  };
  const rootCounts = new Map<TemplateKind, number>();
  for (const kind of ['skills', 'equipment'] as const) {
    rootCounts.set(kind, rootFileCount(fs, kind));
  }
  const planned = new Set<string>();

  for (const candidate of incoming) {
    const path = templatePath(candidate);
    if (path === null) {
      plan.unsafe += 1;
      continue;
    }

    const exists = planned.has(path) || fs.analyzePath(path).exists;
    if (exists) {
      const current = planned.has(path) ? null : readCode(fs, path);
      if (current === candidate.code) {
        plan.already += 1;
      } else if (policy === 'replace') {
        plan.replaced += 1;
        plan.writes.push(candidate);
        planned.add(path);
      } else {
        plan.taken += 1;
      }
      continue;
    }

    if (candidate.folder === null) {
      const used = rootCounts.get(candidate.kind) ?? 0;
      if (used >= ROOT_LIMIT) {
        plan.full += 1;
        continue;
      }
      rootCounts.set(candidate.kind, used + 1);
    }
    plan.writes.push(candidate);
    planned.add(path);
  }
  return plan;
}

let mutating = false;

/**
 * Change the mount and make the change durable.
 *
 * The result is resolved from inside the `syncfs` callback, never before: the
 * mount auto-persists but offers no transaction, so a quit part-way through
 * leaves an arbitrary prefix saved. Reporting only what the sync has seen is
 * what keeps a partial write truthful rather than silent, and the in-flight
 * flag keeps two of these from overlapping each other or the quit path's own
 * synchronisation.
 */
async function mutate<T>(fs: TemplateFileSystem, change: () => T): Promise<T> {
  if (mutating) throw new Error('a template operation is already running');
  mutating = true;
  try {
    const result = change();
    await new Promise<void>((resolve, reject) => {
      fs.syncfs(false, (error) => {
        if (error) reject(error instanceof Error ? error : new Error('sync failed'));
        else resolve();
      });
    });
    return result;
  } finally {
    mutating = false;
  }
}

/** Only for tests: the flag is module state and a failed run must not strand it. */
export function mutationInFlight(): boolean {
  return mutating;
}

export async function applyImport(
  fs: TemplateFileSystem,
  plan: ImportPlan,
): Promise<number> {
  return mutate(fs, () => {
    let written = 0;
    for (const candidate of plan.writes) {
      const path = templatePath(candidate);
      if (path === null) continue;
      const cut = path.lastIndexOf('/');
      fs.mkdirTree(path.slice(0, cut));
      fs.writeFile(path, candidate.code);
      written += 1;
    }
    return written;
  });
}

/**
 * Templates the game has no way to reach.
 *
 * The client's scan enumerates `Templates/<type>/*.txt` and never descends, so
 * anything in a subfolder is listed by no dialog, loaded by no character, and
 * deleted by nothing — the game cannot even show it to offer. Only this side
 * can see them, so only this side can get them out.
 */
export function strandedTemplates(fs: TemplateFileSystem): TemplateCandidate[] {
  return readTemplates(fs).filter((template) => template.folder !== null);
}

/** The name a rescued template takes, keeping the folder it came from. */
function rescuedName(template: TemplateCandidate): string {
  const prefixed = sanitiseTemplateName(`${template.folder} - ${template.name}`);
  return prefixed || template.name;
}

export interface RescueOutcome {
  moved: number;
  /** Left where they are: the root name is taken by a different build, or full. */
  blocked: number;
}

/**
 * Move every stranded template up into its type root, where the game will list
 * it. Nothing is destroyed: a template whose rescued name is already taken by a
 * different build stays where it is and is reported, because losing either of
 * the two would be worse than leaving one unreachable.
 *
 * The emptied folder is removed as well — the client's directory scan does find
 * those, so leaving one behind means a folder that opens onto nothing.
 */
export async function rescueStranded(
  fs: TemplateFileSystem,
): Promise<RescueOutcome> {
  const stranded = strandedTemplates(fs);
  return mutate(fs, () => {
    const outcome: RescueOutcome = { moved: 0, blocked: 0 };
    const emptied = new Set<string>();
    const rootCounts = new Map<TemplateKind, number>();

    for (const template of stranded) {
      const from = templatePath(template);
      const to = templatePath({ ...template, folder: null, name: rescuedName(template) });
      if (from === null || to === null) {
        outcome.blocked += 1;
        continue;
      }

      const existing = fs.analyzePath(to).exists ? readCode(fs, to) : null;
      if (existing !== null && existing !== template.code) {
        outcome.blocked += 1;
        continue;
      }
      if (existing === null) {
        const used = rootCounts.get(template.kind) ?? rootFileCount(fs, template.kind);
        if (used >= ROOT_LIMIT) {
          outcome.blocked += 1;
          continue;
        }
        rootCounts.set(template.kind, used + 1);
        fs.writeFile(to, template.code);
      }
      // An identical copy already at the root makes this one redundant, so the
      // stranded file goes either way.
      fs.unlink(from);
      outcome.moved += 1;
      emptied.add(from.slice(0, from.lastIndexOf('/')));
    }

    for (const directory of emptied) {
      try {
        fs.rmdir(directory);
      } catch {
        // Something this code does not manage is still in there. Leaving the
        // folder is correct; it is not ours to empty.
      }
    }
    return outcome;
  });
}

function rootFileCount(fs: TemplateFileSystem, kind: TemplateKind): number {
  const directory = TEMPLATE_DIRECTORIES[kind];
  return listing(fs, directory).filter(
    (entry) =>
      entry.toLowerCase().endsWith(EXTENSION)
      && !isDirectory(fs, `${directory}/${entry}`),
  ).length;
}
