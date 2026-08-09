/**
 * The Templates pane: its elements, the states it moves between, and the
 * sentences it says.
 *
 * Owns: turning a picked folder, a set of files, or the clipboard into a
 * preview, and turning a finished import or export into one honest sentence.
 * The preview is the confirmation — nothing is written until the player has
 * seen what would land and chosen it.
 *
 * Refuses to reach the filesystem or the format rules itself. It composes what
 * `template-store.ts` and `template-format.ts` return, and it reaches the main
 * process only through the ports it is handed, so every sentence here can be
 * tested without a window.
 */

import type { TemplateExportResult } from '../shared/contracts.js';
import { describeTemplateExportFailure } from './failure-messages.js';
import {
  type TemplateCandidate,
  type TemplateParse,
  MAX_FILE_BYTES,
  combineParses,
  decodeTemplateText,
  namePrefixFromRelativePath,
  parseTemplateSource,
  sanitiseTemplateName,
  sourceNameFromFileName,
} from './template-format.js';
import {
  type CollisionPolicy,
  type ImportPlan,
  type RescueOutcome,
  applyImport,
  exportEntries,
  planImport,
  readTemplates,
  rescueStranded,
  strandedTemplates,
  templateFilesystem,
} from './template-store.js';

/**
 * Why the pane can be open while there is nothing to work with: the mount is
 * created in `Module.preRun`, which runs only once ArenaNet's glue has loaded.
 * Settings opens from the launcher and from the app menu long before that.
 */
const NO_MOUNT =
  'Templates are saved inside Guild Wars, so they can be imported and '
  + 'exported once the game has started.';

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

export interface TemplatePorts {
  exportToDisk(
    entries: readonly { path: string; contents: string }[],
  ): Promise<TemplateExportResult>;
  readClipboard(): Promise<string>;
}

export interface TemplatePane {
  refresh(): void;
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

function element(root: Document, id: string): HTMLElement {
  const node = root.getElementById(id);
  if (!node) throw new Error(`missing template element: ${id}`);
  return node;
}

export function bindTemplatePane(
  root: Document,
  ports: TemplatePorts,
): TemplatePane {
  const status = element(root, 'templates-status');
  const actions = element(root, 'templates-actions');
  const help = element(root, 'templates-help');
  const exportButton = element(root, 'templates-export') as HTMLButtonElement;
  const importFolder = element(root, 'templates-import-folder') as HTMLButtonElement;
  const importFiles = element(root, 'templates-import-files') as HTMLButtonElement;
  const importClipboard = element(root, 'templates-import-clipboard') as HTMLButtonElement;
  const rescue = element(root, 'templates-rescue');
  const rescueNote = element(root, 'templates-rescue-note');
  const rescueMove = element(root, 'templates-rescue-move') as HTMLButtonElement;
  const preview = element(root, 'templates-preview');
  const previewSummary = element(root, 'templates-preview-summary');
  const previewSkipped = element(root, 'templates-preview-skipped');
  const nameField = element(root, 'templates-name-field');
  const nameInput = element(root, 'templates-name') as HTMLInputElement;
  const confirm = element(root, 'templates-confirm') as HTMLButtonElement;
  const cancel = element(root, 'templates-cancel') as HTMLButtonElement;
  const folderInput = element(root, 'templates-file-folder') as HTMLInputElement;
  const filesInput = element(root, 'templates-file-files') as HTMLInputElement;

  interface Picked {
    parse: TemplateParse;
    /**
     * Re-read the same text under a name the player typed. Null for a file
     * source: those carry their own names, one per file.
     */
    rename: ((name: string) => TemplateParse) | null;
    /**
     * Whether the source held a code with no name of its own. Decided once, at
     * the moment it was picked: naming it makes `autoNamed` fall to zero, and
     * recomputing would take the field away mid-keystroke.
     */
    namable: boolean;
  }

  let picked: Picked | null = null;
  let busy = false;

  const policy = (): CollisionPolicy =>
    root.querySelector<HTMLInputElement>('input[name="templateCollision"]:checked')
      ?.value === 'replace'
      ? 'replace'
      : 'skip';

  const closePreview = () => {
    picked = null;
    preview.hidden = true;
    nameField.hidden = true;
    nameInput.value = '';
    folderInput.value = '';
    filesInput.value = '';
  };

  const refresh = () => {
    const fs = templateFilesystem();
    if (!fs) {
      status.textContent = NO_MOUNT;
      actions.hidden = true;
      help.hidden = true;
      rescue.hidden = true;
      closePreview();
      return;
    }
    const stored = readTemplates(fs);
    status.textContent = describeStored(stored);
    actions.hidden = false;
    help.hidden = false;
    // A status is never a button: with nothing saved there is nothing to export.
    exportButton.hidden = stored.length === 0;

    // Only ever shown when there is something wrong. Nothing this app does now
    // creates a stranded template; one can survive an older version, or a
    // folder the game itself wrote. The store owns what "stranded" means, so
    // the offer and the action it triggers cannot disagree about it.
    const stranded = strandedTemplates(fs).length;
    rescue.hidden = stranded === 0;
    if (stranded > 0) rescueNote.textContent = describeStranded(stranded);
  };

  const showPreview = (next: Picked) => {
    picked = next;
    // Checked again here rather than trusted from refresh: the client can die
    // between opening the pane and picking a folder.
    const fs = templateFilesystem();
    if (!fs) {
      // refresh() is what restores the pane to its no-mount state; setting the
      // sentence alone would leave the controls hidden with no way back.
      closePreview();
      refresh();
      return;
    }
    // The preview is the task now. Leaving the four source buttons stacked
    // above it pushes the pane past the height the sheet is designed to hold,
    // and offers actions that would only throw the preview away — Cancel is
    // the way back.
    actions.hidden = true;
    help.hidden = true;
    rescue.hidden = true;

    const { parse } = next;
    const plan = planImport(fs, parse.candidates, policy());
    previewSummary.textContent = describePreview(plan);
    previewSkipped.textContent = describeSkips(plan, parse);
    previewSkipped.hidden = previewSkipped.textContent === '';
    const revealed = next.namable && nameField.hidden;
    nameField.hidden = !next.namable;
    confirm.textContent = plan.writes.length === 0
      ? 'Import'
      : `Import ${plural(plan.writes.length, 'Template')}`;
    confirm.disabled = plan.writes.length === 0;
    preview.hidden = false;
    // A pasted code has no name and the field is the obvious next act, so the
    // caret goes there rather than making the player find it. Only on the
    // reveal: doing it every render would fight the typing it exists for.
    if (revealed) nameInput.focus();
  };

  const pick = async (load: () => Promise<Picked>) => {
    if (busy) return;
    busy = true;
    // A name typed for the last source has nothing to do with this one, and
    // leaving it visible would show a name the new parse does not use.
    nameInput.value = '';
    try {
      showPreview(await load());
    } catch {
      // refresh() first: a failed pick after an open preview would otherwise
      // leave the source buttons hidden with nothing to bring them back.
      closePreview();
      refresh();
      status.textContent =
        'Those templates could not be read. Choose Guild Wars .txt files '
        + 'or copy a valid template code and try again.';
    } finally {
      busy = false;
    }
  };

  importFolder.addEventListener('click', () => folderInput.click());
  importFiles.addEventListener('click', () => filesInput.click());
  importClipboard.addEventListener('click', () => {
    void pick(async () => {
      const text = await ports.readClipboard();
      // A typed name is read exactly the way a filename is: one code takes it
      // whole, several take it numbered, and a code that arrived with its own
      // name keeps that name.
      const rename = (name: string) =>
        parseTemplateSource(text, {
          sourceName: sanitiseTemplateName(name) || null,
          namePrefix: null,
        });
      const parse = rename('');
      return { parse, rename, namable: parse.autoNamed > 0 };
    });
  });

  for (const input of [folderInput, filesInput]) {
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      if (files.length === 0) return;
      void pick(async () => ({
        parse: await parseFiles(files),
        rename: null,
        namable: false,
      }));
    });
  }

  nameInput.addEventListener('input', () => {
    if (!picked?.rename) return;
    showPreview({ ...picked, parse: picked.rename(nameInput.value) });
  });

  // The plan depends on it, so it re-derives against what is saved now.
  for (const radio of root.querySelectorAll<HTMLInputElement>(
    'input[name="templateCollision"]',
  )) {
    radio.addEventListener('change', () => {
      if (picked) showPreview(picked);
    });
  }

  cancel.addEventListener('click', () => {
    closePreview();
    refresh();
  });

  confirm.addEventListener('click', () => {
    const chosen = picked;
    const fs = templateFilesystem();
    if (!chosen || !fs || busy) return;
    busy = true;
    confirm.disabled = true;
    void applyImport(fs, planImport(fs, chosen.parse.candidates, policy()))
      .then((written) => {
        closePreview();
        refresh();
        status.textContent = describeImported(written);
      })
      .catch(() => {
        closePreview();
        refresh();
        status.textContent =
          'Those templates could not be saved. Nothing changed; make sure '
          + 'Guild Wars is still running and try again.';
      })
      .finally(() => {
        busy = false;
      });
  });

  rescueMove.addEventListener('click', () => {
    const fs = templateFilesystem();
    if (!fs || busy) return;
    busy = true;
    rescueMove.disabled = true;
    void rescueStranded(fs)
      .then((outcome) => {
        refresh();
        status.textContent = describeRescue(outcome);
      })
      .catch(() => {
        refresh();
        status.textContent = 'Those templates could not be moved.';
      })
      .finally(() => {
        busy = false;
        rescueMove.disabled = false;
      });
  });

  exportButton.addEventListener('click', () => {
    const fs = templateFilesystem();
    if (!fs || busy) return;
    busy = true;
    exportButton.disabled = true;
    void ports
      .exportToDisk(exportEntries(fs))
      .then((result) => {
        const sentence = describeExport(result);
        if (sentence !== null) status.textContent = sentence;
      })
      .catch(() => {
        status.textContent = describeTemplateExportFailure('unknown');
      })
      .finally(() => {
        busy = false;
        exportButton.disabled = false;
      });
  });

  return { refresh };
}
