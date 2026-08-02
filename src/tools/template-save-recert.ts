/**
 * The template-save recertification report: run the shape-based derivation over
 * a client module and say how the result differs from the entry in the table.
 *
 * The derivation itself belongs to `template-save-verifier.ts` and is
 * re-exported rather than reimplemented, so the manual report and the
 * production decision cannot drift. What this file owns is the comparison and
 * the shape of its output.
 *
 * An empty difference list means the checked-in entry is still exact. A
 * non-empty one is a finding for a human to read, never an entry to apply: a
 * build already in the table was certified by somebody, and this file refuses
 * to overwrite it.
 *
 * It also owns how a *new* entry is spelled into the authoring table, so the
 * text a developer pastes and the text CI splices in are produced by the same
 * function and cannot drift into two formats of the same fact.
 */
import {
  analyzeTemplateSaveCandidate,
} from "../main/certification/template-save-verifier.js";
import {
  findTemplateSaveBuild,
  TEMPLATE_SAVE_BUILDS,
  type CallSite,
  type KnownTemplateSaveBuild,
} from "../main/certification/template-save-compat.js";

export {
  deriveTemplateSaveBuild,
  draftTemplateSaveBuild,
} from "../main/certification/template-save-verifier.js";

function sortSites(sites: readonly CallSite[]): CallSite[] {
  return [...sites].sort(
    (left, right) =>
      left.localFunction - right.localFunction
      || left.bodyOffset - right.bodyOffset,
  );
}

/** Field-by-field difference against the checked-in entry; [] means identical. */
export function compareToCertified(
  entry: KnownTemplateSaveBuild,
): string[] {
  const certified = TEMPLATE_SAVE_BUILDS.find(
    (build) => build.sha256 === entry.sha256,
  );
  if (!certified) return [`no certified entry for ${entry.sha256}`];
  const differences: string[] = [];
  const compare = (what: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      differences.push(
        `${what}: derived ${JSON.stringify(left)}`
        + ` vs certified ${JSON.stringify(right)}`,
      );
    }
  };
  compare("outputSha256", entry.outputSha256, certified.outputSha256);
  compare("importCount", entry.importCount, certified.importCount);
  compare("carrierImport", entry.carrierImport, certified.carrierImport);
  compare(
    "bridge kinds",
    entry.bridges.map((bridge) => bridge.kind),
    certified.bridges.map((bridge) => bridge.kind),
  );
  for (const bridge of entry.bridges) {
    const other = certified.bridges.find(
      (value) => value.kind === bridge.kind,
    );
    if (!other) continue;
    compare(
      `${bridge.kind}.stubFunction`,
      bridge.stubFunction,
      other.stubFunction,
    );
    compare(
      `${bridge.kind}.stubBody`,
      bridge.stubBody ?? null,
      other.stubBody ?? null,
    );
    compare(
      `${bridge.kind}.callSites`,
      sortSites(bridge.callSites),
      sortSites(other.callSites),
    );
  }
  return differences;
}

export function inspectTemplateSaveCandidate(
  input: Uint8Array,
) {
  const analysis = analyzeTemplateSaveCandidate(input);
  const certified = findTemplateSaveBuild(analysis.sha256) !== null;
  const differences = analysis.entry && certified
    ? compareToCertified(analysis.entry)
    : [];
  return {
    ...analysis,
    status: analysis.status === "derived" && certified
      ? "certified"
      : analysis.status,
    certified,
    matchesCertifiedEntry: certified
      ? differences.length === 0
      : null,
    diagnostics: [
      ...analysis.diagnostics,
      ...differences.map(
        (value) => `differs from certified entry — ${value}`,
      ),
    ],
  };
}

/** The authoring table, as `certification template --write` addresses it. */
export const TEMPLATE_SAVE_TABLE =
  "src/main/certification/template-save-compat.ts";

const TABLE_OPEN =
  "export const TEMPLATE_SAVE_BUILDS: readonly KnownTemplateSaveBuild[] =\n"
  + "  Object.freeze([\n";
const TABLE_CLOSE = "\n  ]);\n";

/**
 * The derived entry appended to `TEMPLATE_SAVE_BUILDS`.
 *
 * Appended, not prepended: the *last* member is the shape baseline that
 * `deriveEquivalentTemplateSaveBuild` and `local-client-verifier.ts` compare a
 * structurally derived candidate against, so a newer entry anywhere else
 * silently makes an older build the standard every unknown client is measured
 * by.
 *
 * Only ever an insertion. An entry already in the table is a build somebody
 * certified, and overwriting it here would let a derivation quietly replace a
 * reviewed fact. A table this cannot find is a refusal too — a silent no-op
 * would produce a branch that changes nothing and reads as success.
 */
export function insertBuildEntry(
  source: string,
  entry: KnownTemplateSaveBuild,
): string {
  if (source.includes(`"${entry.sha256}"`)) {
    throw new Error(`${TEMPLATE_SAVE_TABLE} already lists ${entry.sha256}`);
  }
  const open = source.indexOf(TABLE_OPEN);
  const close = open < 0
    ? -1
    : source.indexOf(TABLE_CLOSE, open + TABLE_OPEN.length);
  if (close < 0) {
    throw new Error(`${TEMPLATE_SAVE_TABLE} has no TEMPLATE_SAVE_BUILDS table to extend`);
  }
  const at = close + 1;
  return `${source.slice(0, at)}${formatBuildEntry(entry)}\n${source.slice(at)}`;
}

/** Paste-ready TypeScript for the entry, emitted to stderr by the CLI. */
export function formatBuildEntry(entry: KnownTemplateSaveBuild): string {
  const site = (value: CallSite) =>
    `            Object.freeze({ localFunction: ${value.localFunction},`
      + ` bodyOffset: ${value.bodyOffset} }),`;
  const body = (values: readonly number[]) =>
    values
      .map((value) => `0x${value.toString(16).padStart(2, "0")}`)
      .join(", ");
  const bridges = entry.bridges.map((bridge) => {
    const stub = bridge.stubBody
      ? `          stubBody: Object.freeze([${body(bridge.stubBody)}]),\n`
      : "";
    return (
      `        Object.freeze({\n`
      + `          kind: "${bridge.kind}" as const,\n`
      + `          stubFunction: ${bridge.stubFunction},\n`
      + stub
      + `          callSites: Object.freeze([\n`
      + `${sortSites(bridge.callSites).map(site).join("\n")}\n`
      + `          ]),\n`
      + `        }),`
    );
  });
  return (
    `    Object.freeze({\n`
    + `      sha256:\n        "${entry.sha256}",\n`
    + `      outputSha256:\n        "${entry.outputSha256}",\n`
    + `      importCount: ${entry.importCount},\n`
    + `      carrierImport: ${entry.carrierImport},\n`
    + `      bridges: Object.freeze([\n${bridges.join("\n")}\n      ]),\n`
    + `    }),`
  );
}
