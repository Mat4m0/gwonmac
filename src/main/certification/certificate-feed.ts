/**
 * The certificate feed: its schema, the one parser that turns bytes into it,
 * the one serialiser that turns it back, and the bundled snapshot derived from
 * the shipped tables.
 *
 * A feed is **data only**. Every leaf is a hash, an address, an index or a
 * message identifier — there is no field an instruction, an expression or a
 * path could travel in, so nothing a feed says can be executed. What it can do
 * is *propose* a certificate for a client build; `certificate-feed-proof.ts`
 * decides whether the proposal survives the existing structural transforms, and
 * only what survives may enable anything. The two halves of an entry are not
 * equally re-derivable, so they are not equally trusted: the template-save half
 * is proved against the client bytes, while the enhancement half is accepted
 * only as a restatement of the shipped table — `certifiedEnhancementFromFeed`
 * is that rule and states why. A key holder can therefore withhold a
 * certificate, and cannot mint an unsound one.
 *
 * The entry shape is not a second declaration of what a certificate is: it *is*
 * `KnownTemplateSaveBuild` plus `KnownEnhancementBuild`, the two records
 * `certifyClientBuild` already consumes, so a feed cannot describe a fact the
 * subsystem cannot use or omit one it needs. `certifiedBuildTablesFromFeed`
 * states that equivalence in the chain's own vocabulary; how a feed actually
 * reaches a launch is one proved entry at a time, and `client-runtime.ts` owns
 * that order.
 *
 * The parser treats its input as hostile and refuses rather than repairs:
 * unknown fields, absent fields, values outside their declared range, more
 * entries or bytes than the caps allow, a duplicate or unsorted key, a bridge
 * set that is not the closed five in `BRIDGE_KINDS` order. Every accepted
 * spelling is the only spelling, which is what makes `serializeCertificateFeed`
 * and `parseCertificateFeed` exact inverses and a feed's bytes comparable.
 *
 * This module owns no signature and no file, and it never decides that a
 * proposed certificate holds against client bytes — that is the proof module's
 * answer.
 */
import type { CertifiedBuildTables } from "./client-certification.js";
import {
  ENHANCEMENT_BUILDS,
  ENHANCEMENT_LAYOUT_FIELDS,
  findEnhancementBuild,
  type EnhancementLayout,
  type EnhancementOutputHashes,
  type EnhancementPartyDirtyMessages,
  type KnownEnhancementBuild,
} from "./enhancement-builds.js";
import {
  BRIDGE_KINDS,
  TEMPLATE_SAVE_BUILDS,
  type CallSite,
  type KnownTemplateSaveBuild,
  type StubBridge,
} from "./template-save-compat.js";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  type EnhancementCapabilityProfile,
} from "../../shared/enhancement-contracts.js";
import { AppError } from "../../shared/errors.js";

/**
 * Bump when an accepted feed's meaning changes. A feed declaring any other
 * version is refused outright rather than read field by field, so an older app
 * can never half-understand a newer certificate.
 */
export const CERTIFICATE_FEED_FORMAT_VERSION = 1;

/** The sequence the snapshot compiled into this application carries. */
export const BUNDLED_CERTIFICATE_FEED_SEQUENCE = 1;

// Caps, not guesses: two certified builds serialise to nine kilobytes, an entry
// describes one client build, and every index the transforms use is a WASM
// function or memory word. Nothing here may grow into an allocation an attacker
// chooses.
/** Exported so a transport stops reading at the size the parser would refuse. */
export const MAX_CERTIFICATE_FEED_BYTES = 256 * 1024;
const MAX_ENTRIES = 64;
const MAX_BRIDGE_CALL_SITES = 64;
const MAX_STUB_BODY_BYTES = 256;
const MAX_UNSIGNED_WORD = 0xffff_ffff;
const DIGEST_LENGTH = 64;

const ENHANCEMENT_PROFILES = Object.keys(
  ENHANCEMENT_CAPABILITY_PROFILES,
) as readonly EnhancementCapabilityProfile[];

/**
 * One client build's certificate. `templateSave.sha256` is the official client
 * hash the entry is keyed by; `enhancement`, when present, is keyed by
 * `templateSave.outputSha256` because the second transform runs on what the
 * first produced. A `null` enhancement is a complete, deliberate certificate
 * for a build that saves templates and runs no enhancement tools.
 */
export interface CertificateFeedEntry {
  readonly templateSave: KnownTemplateSaveBuild;
  readonly enhancement: KnownEnhancementBuild | null;
}

export interface CertificateFeed {
  readonly formatVersion: typeof CERTIFICATE_FEED_FORMAT_VERSION;
  /**
   * Monotonic and unsigned. It is the only thing that orders two feeds, so a
   * replayed older feed is recognisable without a clock, a filename or a
   * transport that has to be trusted.
   */
  readonly sequence: number;
  /** Keyed by exact official client SHA-256. */
  readonly entries: ReadonlyMap<string, CertificateFeedEntry>;
}

function refuse(what: string): never {
  throw new AppError("certificate_feed_format", `certificate feed: ${what}`);
}

/**
 * The object at `where`, with the guarantee that it carries these field names
 * and no others. Absent fields are caught by the readers below; a field nobody
 * reads is caught here, because a feed the app does not fully understand is one
 * whose meaning could differ between the signer and the reader.
 */
function object(
  value: unknown,
  where: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse(`${where} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      refuse(`${where} carries unknown field ${JSON.stringify(key)}`);
    }
  }
  return record;
}

function unsignedWord(value: unknown, where: string): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || Object.is(value, -0)
    || value < 0
    || value > MAX_UNSIGNED_WORD
  ) {
    refuse(`${where} must be an unsigned 32-bit integer`);
  }
  return value;
}

function word(record: Record<string, unknown>, key: string, where: string): number {
  return unsignedWord(record[key], `${where}.${key}`);
}

function digest(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (
    typeof value !== "string"
    || value.length !== DIGEST_LENGTH
    || !/^[0-9a-f]+$/.test(value)
  ) {
    refuse(`${where}.${key} must be a lower-case SHA-256 digest`);
  }
  return value;
}

function list(
  record: Record<string, unknown>,
  key: string,
  where: string,
  bounds: { readonly min: number; readonly max: number },
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length < bounds.min || value.length > bounds.max) {
    refuse(
      `${where}.${key} must hold between ${bounds.min} and ${bounds.max} items`,
    );
  }
  return value;
}

/** A fixed-length vector of unsigned words, the shape every ABI tuple has. */
function wordVector(
  record: Record<string, unknown>,
  key: string,
  where: string,
  length: number,
): readonly number[] {
  return list(record, key, where, { min: length, max: length }).map((item, index) =>
    unsignedWord(item, `${where}.${key}[${index}]`),
  );
}

/** A fixed-length vector of the single WASM value type the hooks declare. */
function valueTypes(
  record: Record<string, unknown>,
  key: string,
  where: string,
  length: number,
): void {
  const items = list(record, key, where, { min: length, max: length });
  if (!items.every((item) => item === "i32")) {
    refuse(`${where}.${key} must be ${length} × "i32"`);
  }
}

function callSite(value: unknown, where: string): CallSite {
  const record = object(value, where, ["localFunction", "bodyOffset"]);
  return {
    localFunction: word(record, "localFunction", where),
    bodyOffset: word(record, "bodyOffset", where),
  };
}

function bridge(value: unknown, index: number, where: string): StubBridge {
  const at = `${where}.bridges[${index}]`;
  const record = object(value, at, ["kind", "stubFunction", "stubBody", "callSites"]);
  const kind = BRIDGE_KINDS[index];
  if (kind === undefined || record["kind"] !== kind) {
    refuse(`${at}.kind must be ${JSON.stringify(kind)}`);
  }
  const stubFunction = word(record, "stubFunction", at);
  const callSites = list(record, "callSites", at, {
    min: 1,
    max: MAX_BRIDGE_CALL_SITES,
  }).map((site, siteIndex) => callSite(site, `${at}.callSites[${siteIndex}]`));

  // Absent means "the call site's own target index is the certification", which
  // `fileExists` relies on. Present-and-empty is a different claim, and one the
  // transform would accept as trivially matching, so it is refused.
  if (!("stubBody" in record)) return { kind, stubFunction, callSites };
  const body = list(record, "stubBody", at, { min: 1, max: MAX_STUB_BODY_BYTES });
  const stubBody = body.map((byte) => {
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      refuse(`${at}.stubBody must hold bytes`);
    }
    return byte;
  });
  return { kind, stubFunction, stubBody, callSites };
}

function templateSaveBuild(value: unknown, where: string): KnownTemplateSaveBuild {
  const record = object(value, where, [
    "sha256",
    "outputSha256",
    "importCount",
    "carrierImport",
    "bridges",
  ]);
  const bridges = list(record, "bridges", where, {
    min: BRIDGE_KINDS.length,
    max: BRIDGE_KINDS.length,
  }).map((item, index) => bridge(item, index, where));
  return {
    sha256: digest(record, "sha256", where),
    outputSha256: digest(record, "outputSha256", where),
    importCount: word(record, "importCount", where),
    carrierImport: word(record, "carrierImport", where),
    bridges,
  };
}

function outputHashes(value: unknown, where: string): EnhancementOutputHashes {
  const record = object(value, where, ENHANCEMENT_PROFILES);
  const hashes: Partial<Record<EnhancementCapabilityProfile, string>> = {};
  for (const profile of ENHANCEMENT_PROFILES) {
    hashes[profile] = digest(record, profile, where);
  }
  return hashes as EnhancementOutputHashes;
}

function layout(value: unknown, where: string): EnhancementLayout {
  const record = object(value, where, ENHANCEMENT_LAYOUT_FIELDS);
  const fields: Partial<EnhancementLayout> = {};
  for (const field of ENHANCEMENT_LAYOUT_FIELDS) {
    fields[field] = word(record, field, where);
  }
  return fields as EnhancementLayout;
}

function cursorEvent(value: unknown, where: string): KnownEnhancementBuild["cursorEvent"] {
  const at = `${where}.cursorEvent`;
  const record = object(value, at, [
    "functionIndex",
    "params",
    "results",
    "tableSlot",
    "producerFunctions",
  ]);
  valueTypes(record, "params", at, 5);
  valueTypes(record, "results", at, 0);
  return {
    functionIndex: word(record, "functionIndex", at),
    params: ["i32", "i32", "i32", "i32", "i32"],
    results: [],
    tableSlot: word(record, "tableSlot", at),
    producerFunctions: wordVector(record, "producerFunctions", at, 2) as readonly [
      number,
      number,
    ],
  };
}

function uiDispatcher(value: unknown, where: string): KnownEnhancementBuild["uiDispatcher"] {
  const at = `${where}.uiDispatcher`;
  const record = object(value, at, [
    "functionIndex",
    "params",
    "results",
    "playerChatMessage",
    "hideHeroPanelMessage",
    "showHeroPanelMessage",
    "partyDirtyMessages",
    "playerChatProducer",
    "playerChatSites",
    "nearbyPlayerMessages",
    "nearbyPlayerMessageProducers",
  ]);
  valueTypes(record, "params", at, 3);
  valueTypes(record, "results", at, 0);
  if (record["playerChatSites"] !== 3) {
    refuse(`${at}.playerChatSites must be 3`);
  }
  return {
    functionIndex: word(record, "functionIndex", at),
    params: ["i32", "i32", "i32"],
    results: [],
    playerChatMessage: word(record, "playerChatMessage", at),
    hideHeroPanelMessage: word(record, "hideHeroPanelMessage", at),
    showHeroPanelMessage: word(record, "showHeroPanelMessage", at),
    partyDirtyMessages: wordVector(
      record,
      "partyDirtyMessages",
      at,
      10,
    ) as EnhancementPartyDirtyMessages,
    playerChatProducer: word(record, "playerChatProducer", at),
    playerChatSites: 3,
    nearbyPlayerMessages: wordVector(record, "nearbyPlayerMessages", at, 2) as readonly [
      number,
      number,
    ],
    nearbyPlayerMessageProducers: wordVector(
      record,
      "nearbyPlayerMessageProducers",
      at,
      2,
    ) as readonly [number, number],
  };
}

/**
 * The command table a feed proposes.
 *
 * Read with the same suspicion as everything else here, and one rule of its
 * own: a feed may not propose a command whose opcode this build of the app has
 * never certified. A feed is signed data from off this machine, and the whole
 * point of `commands` is that the callable set is fixed by review rather than
 * by whatever arrives. Widening it is a code change.
 */
function commands(
  value: unknown,
  where: string,
): KnownEnhancementBuild["commands"] {
  const record = object(value, where, [
    "thunkExport", "professionTrace", "drain", "entries",
  ]);
  const thunkExport = record["thunkExport"];
  if (typeof thunkExport !== "string" || !/^[a-z_][a-z0-9_]{0,63}$/.test(thunkExport)) {
    refuse(`${where}.thunkExport must be a plain export name`);
  }
  const traceAt = `${where}.professionTrace`;
  const traceRecord = object(record["professionTrace"], traceAt, [
    "readerExport", "sender",
  ]);
  const readerExport = traceRecord["readerExport"];
  if (
    typeof readerExport !== "string"
    || !/^[a-z_][a-z0-9_]{0,63}$/.test(readerExport)
  ) {
    refuse(`${traceAt}.readerExport must be a plain export name`);
  }
  const senderAt = `${traceAt}.sender`;
  const senderRecord = object(traceRecord["sender"], senderAt, [
    "functionIndex", "params", "results", "bodySha256",
  ]);
  valueTypes(senderRecord, "params", senderAt, 3);
  valueTypes(senderRecord, "results", senderAt, 0);
  const professionTrace = Object.freeze({
    readerExport,
    sender: Object.freeze({
      functionIndex: unsignedWord(
        senderRecord["functionIndex"],
        `${senderAt}.functionIndex`,
      ),
      params: ["i32", "i32", "i32"] as const,
      results: [] as const,
      bodySha256: digest(senderRecord, "bodySha256", senderAt),
    }),
  });
  const known = new Set(
    ENHANCEMENT_BUILDS.flatMap((build) =>
      build.commands.entries.map((entry) => entry.opcode)),
  );
  const drainAt = `${where}.drain`;
  const drainRecord = object(record["drain"], drainAt, [
    "functionIndex", "params", "results", "tableSlot", "bodySha256",
  ]);
  valueTypes(drainRecord, "params", drainAt, 2);
  valueTypes(drainRecord, "results", drainAt, 0);
  const drain = Object.freeze({
    functionIndex: unsignedWord(
      drainRecord["functionIndex"],
      `${drainAt}.functionIndex`,
    ),
    params: ["i32", "i32"] as const,
    results: [] as const,
    tableSlot: unsignedWord(drainRecord["tableSlot"], `${drainAt}.tableSlot`),
    bodySha256: digest(drainRecord, "bodySha256", drainAt),
  });
  const entries = list(record, "entries", where, { min: 0, max: 32 })
    .map((item, index) => {
      const at = `${where}.entries[${index}]`;
      const entry = object(item, at, [
        "opcode", "functionIndex", "params", "results", "bodySha256", "label",
      ]);
      const opcode = unsignedWord(entry["opcode"], `${at}.opcode`);
      if (!known.has(opcode)) {
        refuse(`${at}.opcode ${opcode} is not a command this build certifies`);
      }
      const label = entry["label"];
      if (typeof label !== "string" || label.length > 96) {
        refuse(`${at}.label must be a short string`);
      }
      valueTypes(entry, "params", at, valueTypeCount(entry["params"], at));
      valueTypes(entry, "results", at, 0);
      return Object.freeze({
        opcode,
        functionIndex: unsignedWord(entry["functionIndex"], `${at}.functionIndex`),
        params: (entry["params"] as readonly string[]).map(() => "i32" as const),
        results: [] as const,
        bodySha256: digest(entry, "bodySha256", at),
        label,
      });
    });
  if (new Set(entries.map((entry) => entry.opcode)).size !== entries.length) {
    refuse(`${where}.entries repeats an opcode`);
  }
  return Object.freeze({
    thunkExport,
    professionTrace,
    drain,
    entries: Object.freeze(entries),
  });
}

/** How many arguments a proposed command declares, bounded before it is read. */
function valueTypeCount(value: unknown, where: string): number {
  if (!Array.isArray(value) || value.length > 4) {
    refuse(`${where}.params must be at most four value types`);
  }
  return value.length;
}

function enhancementBuild(value: unknown, where: string): KnownEnhancementBuild {
  const record = object(value, where, [
    "sha256",
    "outputSha256",
    "programId",
    "buildId",
    "hookFunction",
    "hookParams",
    "hookResults",
    "tableSlot",
    "commands",
    "cursorEvent",
    "uiDispatcher",
    "layout",
  ]);
  valueTypes(record, "hookParams", where, 1);
  valueTypes(record, "hookResults", where, 0);
  return {
    sha256: digest(record, "sha256", where),
    outputSha256: outputHashes(record["outputSha256"], `${where}.outputSha256`),
    programId: word(record, "programId", where),
    buildId: word(record, "buildId", where),
    hookFunction: word(record, "hookFunction", where),
    hookParams: ["i32"],
    hookResults: [],
    tableSlot: word(record, "tableSlot", where),
    commands: commands(record["commands"], `${where}.commands`),
    cursorEvent: cursorEvent(record["cursorEvent"], where),
    uiDispatcher: uiDispatcher(record["uiDispatcher"], where),
    layout: layout(record["layout"], `${where}.layout`),
  };
}

function feedEntry(value: unknown, index: number): CertificateFeedEntry {
  const where = `entries[${index}]`;
  const record = object(value, where, ["templateSave", "enhancement"]);
  const templateSave = templateSaveBuild(record["templateSave"], `${where}.templateSave`);
  const proposed = record["enhancement"];
  if (proposed === null) return { templateSave, enhancement: null };
  const enhancement = enhancementBuild(proposed, `${where}.enhancement`);
  // The second transform reads what the first produced. An entry that claims
  // otherwise describes a chain that cannot exist, so it is refused here rather
  // than left for the proof to discover against bytes it may never see.
  if (enhancement.sha256 !== templateSave.outputSha256) {
    refuse(`${where}.enhancement is not keyed by the template-save output hash`);
  }
  return { templateSave, enhancement };
}

/**
 * Bytes to feed, or a refusal. The signature, if the bytes came from off this
 * machine, is `certificate-feed-trust.ts`'s job and has already run.
 */
export function parseCertificateFeed(bytes: Uint8Array): CertificateFeed {
  if (bytes.byteLength === 0) refuse("no bytes");
  if (bytes.byteLength > MAX_CERTIFICATE_FEED_BYTES) {
    refuse(
      `${bytes.byteLength} bytes exceeds the `
        + `${MAX_CERTIFICATE_FEED_BYTES}-byte cap`,
    );
  }
  // A byte-order mark is a second spelling of the same document, and a signature
  // is over bytes.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    refuse("carries a byte-order mark");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    refuse("is not UTF-8");
  }
  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch {
    refuse("is not JSON");
  }

  const record = object(document, "feed", ["formatVersion", "sequence", "entries"]);
  if (record["formatVersion"] !== CERTIFICATE_FEED_FORMAT_VERSION) {
    refuse(
      `formatVersion must be ${CERTIFICATE_FEED_FORMAT_VERSION}, not `
        + JSON.stringify(record["formatVersion"]),
    );
  }
  const sequence = word(record, "sequence", "feed");
  const items = list(record, "entries", "feed", { min: 0, max: MAX_ENTRIES });

  const entries = new Map<string, CertificateFeedEntry>();
  let previousKey = "";
  for (const [index, item] of items.entries()) {
    const entry = feedEntry(item, index);
    const key = entry.templateSave.sha256;
    // Sorted and unique: two entries for one client build would make "the
    // certificate for this hash" a question about array order.
    if (key <= previousKey) {
      refuse(`entries[${index}] is out of ascending key order or duplicated`);
    }
    previousKey = key;
    entries.set(key, entry);
  }

  return { formatVersion: CERTIFICATE_FEED_FORMAT_VERSION, sequence, entries };
}

/**
 * The exact inverse of the parser. Key order is written out rather than left to
 * object literal inference elsewhere, because these bytes are what a signature
 * covers.
 */
export function serializeCertificateFeed(feed: CertificateFeed): Uint8Array {
  const document = {
    formatVersion: feed.formatVersion,
    sequence: feed.sequence,
    entries: [...feed.entries.values()]
      .sort((left, right) => (left.templateSave.sha256 < right.templateSave.sha256 ? -1 : 1))
      .map((entry) => ({
        templateSave: writeTemplateSave(entry.templateSave),
        enhancement: entry.enhancement === null ? null : writeEnhancement(entry.enhancement),
      })),
  };
  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
}

function writeTemplateSave(build: KnownTemplateSaveBuild): unknown {
  return {
    sha256: build.sha256,
    outputSha256: build.outputSha256,
    importCount: build.importCount,
    carrierImport: build.carrierImport,
    bridges: build.bridges.map((item) => ({
      kind: item.kind,
      stubFunction: item.stubFunction,
      ...(item.stubBody === undefined ? {} : { stubBody: [...item.stubBody] }),
      callSites: item.callSites.map((site) => ({
        localFunction: site.localFunction,
        bodyOffset: site.bodyOffset,
      })),
    })),
  };
}

function writeEnhancement(build: KnownEnhancementBuild): unknown {
  return {
    sha256: build.sha256,
    outputSha256: Object.fromEntries(
      ENHANCEMENT_PROFILES.map((profile) => [profile, build.outputSha256[profile]]),
    ),
    programId: build.programId,
    buildId: build.buildId,
    hookFunction: build.hookFunction,
    hookParams: [...build.hookParams],
    hookResults: [...build.hookResults],
    tableSlot: build.tableSlot,
    commands: {
      thunkExport: build.commands.thunkExport,
      professionTrace: {
        readerExport: build.commands.professionTrace.readerExport,
        sender: {
          functionIndex: build.commands.professionTrace.sender.functionIndex,
          params: [...build.commands.professionTrace.sender.params],
          results: [...build.commands.professionTrace.sender.results],
          bodySha256: build.commands.professionTrace.sender.bodySha256,
        },
      },
      drain: {
        functionIndex: build.commands.drain.functionIndex,
        params: [...build.commands.drain.params],
        results: [...build.commands.drain.results],
        tableSlot: build.commands.drain.tableSlot,
        bodySha256: build.commands.drain.bodySha256,
      },
      entries: build.commands.entries.map((entry) => ({
        opcode: entry.opcode,
        functionIndex: entry.functionIndex,
        params: [...entry.params],
        results: [...entry.results],
        bodySha256: entry.bodySha256,
        label: entry.label,
      })),
    },
    cursorEvent: {
      functionIndex: build.cursorEvent.functionIndex,
      params: [...build.cursorEvent.params],
      results: [...build.cursorEvent.results],
      tableSlot: build.cursorEvent.tableSlot,
      producerFunctions: [...build.cursorEvent.producerFunctions],
    },
    uiDispatcher: {
      functionIndex: build.uiDispatcher.functionIndex,
      params: [...build.uiDispatcher.params],
      results: [...build.uiDispatcher.results],
      playerChatMessage: build.uiDispatcher.playerChatMessage,
      hideHeroPanelMessage: build.uiDispatcher.hideHeroPanelMessage,
      showHeroPanelMessage: build.uiDispatcher.showHeroPanelMessage,
      partyDirtyMessages: [...build.uiDispatcher.partyDirtyMessages],
      playerChatProducer: build.uiDispatcher.playerChatProducer,
      playerChatSites: build.uiDispatcher.playerChatSites,
      nearbyPlayerMessages: [...build.uiDispatcher.nearbyPlayerMessages],
      nearbyPlayerMessageProducers: [...build.uiDispatcher.nearbyPlayerMessageProducers],
    },
    layout: Object.fromEntries(
      ENHANCEMENT_LAYOUT_FIELDS.map((field) => [field, build.layout[field]]),
    ),
  };
}

/**
 * The enhancement half of an entry, if it may be believed, and `null` otherwise.
 *
 * The template-save half of a certificate is re-derived from the client bytes:
 * every stub body, every call-site signature and the output hash are proved, so
 * a feed may certify a build no release has seen. The enhancement half is not
 * symmetric. Its hook signatures and table slot are structurally checked, but
 * the layout words are client-memory addresses the companion kernel reads and
 * writes, and the message identifiers are numbers — neither has a structural
 * anchor, so a claimed `outputSha256` computed over the signer's own chosen
 * addresses would reproduce and prove nothing the signer did not choose. A
 * stolen key could then redirect the kernel inside client memory, which is more
 * than denying service.
 *
 * So a feed's enhancement facts are accepted only as an exact restatement of
 * `ENHANCEMENT_BUILDS`, compared in the canonical spelling a signature covers
 * rather than by object key order. A feed may therefore certify template saving
 * for a new build and never enhancement execution — the same asymmetry the
 * isolated local proof already enforces. Until layout facts gain their own
 * anchors, that is what keeps a compromised key to denial of service.
 */
export function certifiedEnhancementFromFeed(
  entry: CertificateFeedEntry,
): KnownEnhancementBuild | null {
  const proposed = entry.enhancement;
  if (proposed === null) return null;
  const certified = findEnhancementBuild(proposed.sha256);
  if (certified === null) return null;
  return JSON.stringify(writeEnhancement(certified))
      === JSON.stringify(writeEnhancement(proposed))
    ? certified
    : null;
}

/**
 * Snapshot #1: the shipped tables expressed as a feed. The TypeScript tables
 * stay the authoring source — the isolated proof is compiled against them and
 * cannot read a file — and this is the derived artifact, so an entry is added
 * in one place only.
 */
export function bundledCertificateFeed(): CertificateFeed {
  const entries = new Map<string, CertificateFeedEntry>();
  for (const templateSave of TEMPLATE_SAVE_BUILDS) {
    entries.set(templateSave.sha256, {
      templateSave,
      enhancement: findEnhancementBuild(templateSave.outputSha256),
    });
  }
  // An enhancement entry whose input is not any table's template-save output is
  // unreachable through the chain, and silently dropping it would let the
  // bundled snapshot disagree with the tables it is derived from.
  for (const build of ENHANCEMENT_BUILDS) {
    if (![...entries.values()].some((entry) => entry.enhancement === build)) {
      refuse(`enhancement build ${build.sha256} follows no certified template-save output`);
    }
  }
  return {
    formatVersion: CERTIFICATE_FEED_FORMAT_VERSION,
    sequence: BUNDLED_CERTIFICATE_FEED_SEQUENCE,
    entries,
  };
}

/**
 * The two lookups `certifyClientBuild` takes, read out of a feed: what a feed's
 * contents *mean* expressed in the vocabulary the rest of the chain already
 * speaks, which is what makes "a feed answers exactly what the shipped tables
 * answer" a statement that can be executed rather than argued.
 *
 * It is deliberately not how a feed reaches a launch. `client-runtime.ts` asks
 * the shipped tables first and consults the feed only where they say nothing,
 * one entry at a time and through `certificate-feed-proof.ts` — so a feed can
 * widen where a certificate comes from and can never withdraw one. These
 * tables would answer for a whole feed at once and take its word for the
 * lookup; nothing hands them to a launch, and nothing should.
 */
export function certifiedBuildTablesFromFeed(feed: CertificateFeed): CertifiedBuildTables {
  const byEnhancementInput = new Map<string, KnownEnhancementBuild>();
  for (const entry of feed.entries.values()) {
    const enhancement = certifiedEnhancementFromFeed(entry);
    if (enhancement) byEnhancementInput.set(enhancement.sha256, enhancement);
  }
  return {
    templateSave: (sha256) => feed.entries.get(sha256)?.templateSave ?? null,
    enhancement: (sha256) => byEnhancementInput.get(sha256) ?? null,
  };
}

/**
 * Which of two feeds governs. A candidate must be strictly newer to replace the
 * one in hand, so a captured older feed replayed at the app cannot withdraw a
 * certificate it already holds — the worst a replay achieves is no change.
 */
export function governingCertificateFeed(
  current: CertificateFeed,
  candidate: CertificateFeed,
): { readonly feed: CertificateFeed; readonly accepted: boolean } {
  return candidate.sequence > current.sequence
    ? { feed: candidate, accepted: true }
    : { feed: current, accepted: false };
}
