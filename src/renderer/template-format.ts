/**
 * The text form of a Guild Wars build template, in both directions.
 *
 * Owns: decoding a file the way Windows wrote it, recognising a template code,
 * the name rules the client's own name field enforces, the subfolder a picked
 * path implies, and the `.txt` layout an export produces. Every rule here is
 * about text; nothing in this file knows the mounted filesystem, the DOM, or
 * IPC exist.
 *
 * Refuses to decode ArenaNet's template payload. The first character selects a
 * directory and that is the only thing read from it — a stricter guess would
 * reject codes from a template version that has not shipped yet.
 */

// A runtime import, not a type-only one: src/main/protocol.ts serves
// build/shared/contracts.js at gw://app/shared/contracts.js for exactly this.
import { TEMPLATE_CEILINGS } from '../shared/contracts.js';

/** Which of the game's two template directories a code belongs in. */
export type TemplateKind = 'skills' | 'equipment';

export interface TemplateCandidate {
  kind: TemplateKind;
  /**
   * One level below the type directory, or null for the type root. One level
   * is the deepest key the client can express (`\Sub\Name`).
   */
  folder: string | null;
  /** Already sanitised, and never empty. */
  name: string;
  code: string;
}

/** Why a line produced no template. Counts only — the reason is what a player can act on. */
export type TemplateSkipReason = 'no-code' | 'too-many';

export interface TemplateParse {
  candidates: TemplateCandidate[];
  skipped: Record<TemplateSkipReason, number>;
  /** Names the client would have refused, adjusted rather than dropped. */
  renamed: number;
  /** Codes that arrived with no name and were given one. */
  autoNamed: number;
}

// A template is ~200 bytes; this bounds a single picked or pasted list file.
export const MAX_FILE_BYTES = 512 * 1024;

const DEFAULT_NAME_PREFIX = 'Template';

/**
 * The alphabet ArenaNet's template strings use, anchored on the type character.
 * `O` is a skill template and `P` an equipment template; that first character
 * is what routes the file, so it is the one part of the payload read here.
 */
const TEMPLATE_CODE = new RegExp(
  `^[OP][A-Za-z0-9+/]{7,${TEMPLATE_CEILINGS.codeLength - 1}}$`,
);

/** The same shape unanchored, for pulling codes out of a line that carries more. */
const CODE_IN_LINE = `[OP][A-Za-z0-9+/]{7,${TEMPLATE_CEILINGS.codeLength - 1}}`;

const BRACKET_FORM = new RegExp(
  String.raw`\[([^\];]*);\s*(${CODE_IN_LINE})\s*\]`,
  'g',
);

/**
 * Characters the client's own name field refuses, mapped to a space. The dot is
 * in the set, which is also what keeps a name away from this build's off-by-one
 * `Path::RemoveExtension` — the defect documented in
 * src/renderer/template-save-compatibility.ts. `*` and `?` are refused for a
 * second reason: the client lists a directory by glob, and
 * template-save-compatibility.ts turns both into wildcards.
 */
const FORBIDDEN_IN_NAME = /[.,<>:"|?*\p{Cc}]/gu;

/**
 * Directory names that describe the layout rather than a player's own folder.
 * A Windows install nests `Templates/Skills`, and neither level is a subfolder
 * the game would show.
 */
const LAYOUT_DIRECTORIES: ReadonlySet<string> = new Set([
  'templates',
  'skills',
  'equipment',
]);

export function isTemplateCode(value: string): boolean {
  return TEMPLATE_CODE.test(value);
}

export function templateKind(code: string): TemplateKind {
  return code.startsWith('P') ? 'equipment' : 'skills';
}

/**
 * Decode a picked file the way the machine that wrote it meant it.
 *
 * Windows-authored `.txt` commonly carries a UTF-8 BOM or is UTF-16, and a BOM
 * decoded as content lands inside the code — which the client answers with
 * "does not appear to be valid", the failure recorded in round 8 of
 * internal/upstream/investigation-log.md. UTF-16BE is byte-swapped here rather
 * than handed to `TextDecoder`, whose big-endian label needs an ICU build this
 * code cannot assume in both Node and Chromium.
 */
export function decodeTemplateText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = bytes.slice(2);
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const high = swapped[index] ?? 0;
      swapped[index] = swapped[index + 1] ?? 0;
      swapped[index + 1] = high;
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  const utf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return new TextDecoder('utf-8').decode(bytes.subarray(utf8Bom ? 3 : 0));
}

/**
 * The name rules, in the order they have to run.
 *
 * Separators become `-` before anything else, because Guild Wars build names
 * are profession pairs and `Me/E` has to stay readable as `Me-E`. Names are
 * normalised to NFC because macOS hands back NFD where the game wrote NFC, and
 * two spellings of one name would import as a visible duplicate.
 *
 * Returns the empty string when nothing usable survives; the caller names it.
 */
export function sanitiseTemplateName(raw: string): string {
  const collapsed = raw
    .normalize('NFC')
    .replaceAll(/[/\\]/g, '-')
    .replaceAll(FORBIDDEN_IN_NAME, ' ')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/-{2,}/g, '-');
  const trimmed = trimName(collapsed);
  return trimmed.length > TEMPLATE_CEILINGS.nameLength
    ? trimName(trimmed.slice(0, TEMPLATE_CEILINGS.nameLength))
    : trimmed;
}

function trimName(value: string): string {
  return value.replace(/^[\s-]+/, '').replace(/[\s-]+$/, '');
}

/**
 * The folder a picked path implies, kept as part of the imported name rather
 * than as a directory.
 *
 * The client's scan enumerates `Templates/<type>/*.txt` and nothing below it,
 * so a file this app places in a subfolder is written, is visible to an export,
 * and is never listed in game — see `internal/upstream/client-defects.md`.
 * Every import therefore lands in the type root, and a Windows collection's
 * `Warrior/Shockaxe.txt` arrives as `Warrior - Shockaxe`: the organisation
 * survives as a name, which is the only form the client will show.
 *
 * `webkitRelativePath` always begins with the directory the player selected, so
 * that first segment is dropped whatever it is called: picking `Skills` and
 * picking the whole `Guild Wars` folder must produce the same names.
 */
export function namePrefixFromRelativePath(relativePath: string): string | null {
  const segments = relativePath.split('/').filter(Boolean);
  segments.pop();
  const own = segments
    .slice(1)
    .filter((segment) => !LAYOUT_DIRECTORIES.has(segment.toLowerCase()));
  const last = own.at(-1);
  return last === undefined ? null : sanitiseTemplateName(last) || null;
}

/** The template name a file lends to the code it holds. */
export function sourceNameFromFileName(fileName: string): string {
  return fileName.replace(/\.txt$/i, '');
}

interface ParseOptions {
  /** The file this text came from, or null for text with no origin. */
  sourceName: string | null;
  /** The folder it came from, kept in the name because the client cannot list one. */
  namePrefix: string | null;
}

/**
 * Turn one source of text into candidates.
 *
 * A source holding exactly one code is the game's own single-template file and
 * takes its name from the file. Anything else is a list, and each line is read
 * for the forms builds are actually shared in.
 */
export function parseTemplateSource(
  text: string,
  { sourceName, namePrefix }: ParseOptions,
): TemplateParse {
  const parse = emptyParse();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fallback = sourceName ?? DEFAULT_NAME_PREFIX;

  const single = lines.length === 1 ? lines[0] : undefined;
  if (single !== undefined && isTemplateCode(single)) {
    add(parse, { rawName: sourceName, code: single, namePrefix, fallback });
    return parse;
  }

  for (const line of lines) {
    const found = readLine(line);
    if (found.length === 0) {
      parse.skipped['no-code'] += 1;
      continue;
    }
    for (const { rawName, code } of found) {
      add(parse, { rawName, code, namePrefix, fallback });
    }
  }
  return parse;
}

interface FoundCode {
  rawName: string | null;
  code: string;
}

/** The forms a shared build arrives in, first match wins. */
function readLine(line: string): FoundCode[] {
  const bracketed = [...line.matchAll(BRACKET_FORM)].map((match) => ({
    rawName: match[1]?.trim() || null,
    code: match[2] ?? '',
  }));
  if (bracketed.length > 0) return bracketed;

  // A tab, then a colon. `:` is a character the client refuses in a name, so
  // splitting on the first one can never cut a name in half.
  for (const separator of ['\t', ':']) {
    const cut = line.indexOf(separator);
    if (cut < 0) continue;
    const code = line.slice(cut + 1).trim();
    if (!isTemplateCode(code)) continue;
    return [{ rawName: line.slice(0, cut).trim() || null, code }];
  }

  return isTemplateCode(line) ? [{ rawName: null, code: line }] : [];
}

function add(
  parse: TemplateParse,
  options: {
    rawName: string | null;
    code: string;
    namePrefix: string | null;
    fallback: string;
  },
): void {
  const { rawName, code, namePrefix, fallback } = options;
  const sanitised = rawName === null ? '' : sanitiseTemplateName(rawName);
  let name: string;
  if (sanitised === '') {
    parse.autoNamed += 1;
    name = `${fallback} ${parse.autoNamed}`;
  } else {
    name = sanitised;
    if (rawName !== null && sanitised !== rawName.normalize('NFC')) {
      parse.renamed += 1;
    }
  }
  // Every import lands in the type root, so the folder it came from survives as
  // part of the name or not at all.
  const prefixed = namePrefix === null ? name : `${namePrefix} - ${name}`;
  parse.candidates.push({
    kind: templateKind(code),
    folder: null,
    name: sanitiseTemplateName(prefixed) || name,
    code,
  });
}

function emptyParse(): TemplateParse {
  return {
    candidates: [],
    skipped: { 'no-code': 0, 'too-many': 0 },
    renamed: 0,
    autoNamed: 0,
  };
}

/**
 * Fold every parsed source into one, applying the ceiling to the total rather
 * than to any single file: the limit exists to bound one gesture, and a player
 * picks a folder once.
 */
export function combineParses(parses: readonly TemplateParse[]): TemplateParse {
  const combined = emptyParse();
  for (const parse of parses) {
    combined.renamed += parse.renamed;
    combined.autoNamed += parse.autoNamed;
    combined.skipped['no-code'] += parse.skipped['no-code'];
    combined.skipped['too-many'] += parse.skipped['too-many'];
    for (const candidate of parse.candidates) {
      if (combined.candidates.length >= TEMPLATE_CEILINGS.entries) {
        combined.skipped['too-many'] += 1;
      } else {
        combined.candidates.push(candidate);
      }
    }
  }
  return combined;
}

const DIRECTORY: Record<TemplateKind, string> = {
  skills: 'Skills',
  equipment: 'Equipment',
};

/**
 * Where a template lives, relative to the root of an export or of the mount.
 * One rule serves both, so a folder this app writes is a folder it reads.
 */
export function templateRelativePath(candidate: TemplateCandidate): string {
  const parts = [DIRECTORY[candidate.kind]];
  if (candidate.folder) parts.push(candidate.folder);
  parts.push(`${candidate.name}.txt`);
  return parts.join('/');
}
