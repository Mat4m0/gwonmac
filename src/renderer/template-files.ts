/**
 * Template files for the Build Library: the game's saved templates moved in and
 * out as .txt files, and the sentences that report it.
 *
 * Owns: turning a picked folder or set of files into a preview, and turning a
 * finished import or export into one honest sentence. The preview is the
 * confirmation — nothing is written until the player has seen what would land
 * and chosen it.
 *
 * Refuses to reach the filesystem or the format rules itself. It composes what
 * `template-store.ts` and `template-format.ts` return, and it reaches the mount
 * and the main process only through the ports it is handed, so every sentence
 * here can be tested without a window.
 */

import type { TemplateExportResult } from '../shared/contracts.js';
import type { TemplateFiles, TemplateFilesState } from '../shared/tools-bundle-contracts.js';
import { describeTemplateExportFailure } from './failure-messages.js';
import {
  type TemplateCandidate,
  type TemplateParse,
  MAX_FILE_BYTES,
  combineParses,
  decodeTemplateText,
  namePrefixFromRelativePath,
  parseTemplateSource,
  sourceNameFromFileName,
} from './template-format.js';
import {
  type ImportPlan,
  type RescueOutcome,
  type TemplateFileSystem,
  applyImport,
  exportEntries,
  planImport,
  readTemplates,
  rescueStranded,
  strandedTemplates,
} from './template-store.js';

/**
 * Why the dialog can be open while there is nothing to work with: the mount is
 * created in `Module.preRun`, and after an abort the page survives with the
 * client dead.
 */
const NO_MOUNT =
  'Guild Wars is not running in this window, so its templates cannot be read. '
  + 'Start Guild Wars and try again.';

/**
 * The client scans each template directory once and caches the answer — see
 * the scan state machine in internal/upstream/client-internals.md. Files added
 * while it is running are on disk and invisible until that cache is cleared,
 * which is what Refresh List does. Saying so is the difference between a
 * working import and a bug report that says nothing happened.
 */
const REFRESH_LIST =
  'In Guild Wars, open the template manager and choose Refresh List to see them.';

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function countKinds(templates: readonly TemplateCandidate[]): {
  skills: number;
  equipment: number;
} {
  let skills = 0;
  for (const template of templates) if (template.kind === 'skills') skills += 1;
  return { skills, equipment: templates.length - skills };
}

/** What the game currently holds, as the pane's resting status line. */
export function describeStored(templates: readonly TemplateCandidate[]): string {
  if (templates.length === 0) return 'No templates saved yet.';
  const { skills, equipment } = countKinds(templates);
  if (equipment === 0) return `${plural(skills, 'skill template')} saved.`;
  if (skills === 0) return `${plural(equipment, 'equipment template')} saved.`;
  return `${plural(skills, 'skill template')} and ${plural(equipment, 'equipment template')} saved.`;
}

/** What an import would do, before it does any of it. */
export function describePreview(plan: ImportPlan): string {
  if (plan.writes.length === 0) return 'Nothing new to import.';
  const { skills, equipment } = countKinds(plan.writes);
  if (equipment === 0) return `${plural(skills, 'skill template')} will be imported.`;
  if (skills === 0) return `${plural(equipment, 'equipment template')} will be imported.`;
  return `${plural(skills, 'skill template')} and ${plural(equipment, 'equipment template')} will be imported.`;
}

/**
 * The clauses that explain a difference between what was picked and what will
 * land. Only non-zero ones appear, in a fixed order, so two runs of the same
 * import read the same way.
 */
export function describeSkips(plan: ImportPlan, parse: TemplateParse): string {
  const clauses: string[] = [];
  if (plan.already > 0) clauses.push(`${plan.already} already saved`);
  if (plan.taken > 0) {
    clauses.push(`${plan.taken} would replace a different build of the same name`);
  }
  if (plan.full > 0) {
    // Subfolders are the documented way around this limit on Windows and are
    // not usable here: the client never lists what is inside one. So the only
    // honest advice is to make room.
    clauses.push(
      `${plan.full} do not fit — Guild Wars holds at most 550 templates of one `
      + 'kind, so delete some first',
    );
  }
  if (plan.unsafe > 0) {
    clauses.push(`${plural(plan.unsafe, 'name')} the game cannot use`);
  }
  if (parse.skipped['no-code'] > 0) {
    clauses.push(`${plural(parse.skipped['no-code'], 'line')} with no template code`);
  }
  if (parse.skipped['too-many'] > 0) {
    clauses.push(`${parse.skipped['too-many']} past the limit for one import`);
  }
  // Deliberately terse: the Name field sits directly below this line and shows
  // what they will be called, so spelling the numbering out here would say the
  // same thing twice.
  if (parse.autoNamed > 0) {
    clauses.push(`${plural(parse.autoNamed, 'code')} with no name`);
  }
  if (parse.renamed > 0) {
    clauses.push(
      `${plural(parse.renamed, 'name')} adjusted to characters Guild Wars accepts`,
    );
  }
  return clauses.length === 0 ? '' : `Skipped or adjusted: ${clauses.join('; ')}.`;
}

/** What actually happened, reported only once the mount has been synchronised. */
export function describeImported(written: number): string {
  if (written === 0) return 'Nothing was imported.';
  return `Imported ${plural(written, 'template')}. ${REFRESH_LIST}`;
}

/**
 * Templates the game cannot reach. Shown only when there are some, because a
 * permanent line about a state almost nobody is in is noise — and this one is
 * worth interrupting for, since nothing in the game can resolve it.
 */
export function describeStranded(count: number): string {
  return `${plural(count, 'template')} ${count === 1 ? 'is' : 'are'} saved in `
    + 'a folder Guild Wars cannot read, so it is not listed in game.';
}

export function describeRescue(outcome: RescueOutcome): string {
  if (outcome.moved === 0 && outcome.blocked === 0) return 'Nothing to move.';
  const parts: string[] = [];
  if (outcome.moved > 0) {
    parts.push(`Moved ${plural(outcome.moved, 'template')} to the top level.`);
  }
  if (outcome.blocked > 0) {
    parts.push(
      `${plural(outcome.blocked, 'template')} could not be moved because the `
      + 'name is already used by a different build; they are unchanged.',
    );
  }
  if (outcome.moved > 0) parts.push(REFRESH_LIST);
  return parts.join(' ');
}

export function describeExport(result: TemplateExportResult): string | null {
  if (result.status === 'cancelled') return null;
  if (result.status === 'failed') return describeTemplateExportFailure(result.errorCode);
  return `Exported ${plural(result.count, 'template')}.`;
}

export interface TemplateFilesPorts {
  /** The mount, asked again at every use: the client can die while the dialog is open. */
  filesystem(): TemplateFileSystem | null;
  exportToDisk(
    entries: readonly { path: string; contents: string }[],
  ): Promise<TemplateExportResult>;
}

/**
 * Read what the player picked. Anything that is not a `.txt` within the size a
 * template list could plausibly reach is skipped without being opened — a
 * picked Guild Wars folder also holds gw.dat, and nothing here should read four
 * gigabytes to discover it is not a build.
 */
async function parseFiles(files: readonly File[]): Promise<TemplateParse> {
  const usable = files.filter(
    (file) => file.name.toLowerCase().endsWith('.txt') && file.size <= MAX_FILE_BYTES,
  );
  const parses = await Promise.all(
    usable.map(async (file) =>
      parseTemplateSource(decodeTemplateText(await file.arrayBuffer()), {
        sourceName: sourceNameFromFileName(file.name),
        namePrefix: namePrefixFromRelativePath(file.webkitRelativePath || file.name),
      }),
    ),
  );
  return combineParses(parses);
}

const SAVE_FAILED =
  'Those templates could not be saved. Nothing changed; make sure Guild Wars is '
  + 'still running and try again.';

export function createTemplateFiles(ports: TemplateFilesPorts): TemplateFiles {
  const mount = () => {
    const fs = ports.filesystem();
    if (!fs) throw new Error(NO_MOUNT);
    return fs;
  };
  return {
    state(): TemplateFilesState {
      const fs = ports.filesystem();
      if (!fs) return { available: false, reason: NO_MOUNT };
      const stored = readTemplates(fs);
      // Only ever shown when there is something wrong. Nothing this app does now
      // creates a stranded template; one can survive an older version, or a
      // folder the game itself wrote.
      const stranded = strandedTemplates(fs).length;
      return {
        available: true,
        stored: describeStored(stored),
        count: stored.length,
        stranded: stranded === 0 ? null : describeStranded(stranded),
      };
    },
    async read(files) {
      const parse = await parseFiles(files);
      return {
        // Re-planned against what is saved now, so a preview never describes
        // a write the confirm would not make.
        preview(policy) {
          const plan = planImport(mount(), parse.candidates, policy);
          return {
            summary: describePreview(plan),
            skipped: describeSkips(plan, parse),
            count: plan.writes.length,
          };
        },
        async apply(policy) {
          const fs = mount();
          try {
            return describeImported(await applyImport(fs, planImport(fs, parse.candidates, policy)));
          } catch {
            throw new Error(SAVE_FAILED);
          }
        },
      };
    },
    async exportAll() {
      const fs = ports.filesystem();
      if (!fs) return NO_MOUNT;
      try {
        return describeExport(await ports.exportToDisk(exportEntries(fs)));
      } catch {
        return describeTemplateExportFailure('unknown');
      }
    },
    async rescue() {
      const fs = ports.filesystem();
      if (!fs) return NO_MOUNT;
      try {
        return describeRescue(await rescueStranded(fs));
      } catch {
        return 'Those templates could not be moved.';
      }
    },
  };
}
