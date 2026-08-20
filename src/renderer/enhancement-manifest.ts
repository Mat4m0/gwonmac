/**
 * Reads the fixed evidence section the Enhancement transform wrote into the
 * derived module, and refuses anything that is not exactly what this build
 * expects.
 *
 * This is the renderer's proof that the module it was handed came from the
 * transform this build ships. The ABI, the capability set, the hooks and the
 * whole config-word vector must match, with exact key sets rather than
 * supersets, and a field that is merely present is not accepted. Installing
 * hooks against a layout derived from a different client is how a game gets
 * corrupted memory rather than an error message.
 */
import {
  enhancementCapabilitiesRequested,
  ENHANCEMENT_CONFIG_WORD_COUNT,
  ENHANCEMENT_LAYOUT_WORD_COUNT,
  ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT,
  ENHANCEMENT_TRANSFORM_ABI,
  enhancementConfigWordActive,
  enhancementHooksFor,
  type EnhancementCapabilities,
  type EnhancementHooks,
} from "../shared/enhancement-contracts.js";

const MESSAGE_CONFIG_START = ENHANCEMENT_LAYOUT_WORD_COUNT;
const PARTY_DIRTY_CONFIG_START = MESSAGE_CONFIG_START + 3;

/** The validated subset of the derived module's fixed evidence. */
export type EnhancementManifest = Readonly<{
  buildId: number;
  programId: number;
  tableSlot: number;
  capabilities: EnhancementCapabilities;
  hooks: EnhancementHooks;
  configWords: readonly number[];
}>;

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.length
    && keys.every((key) => Object.hasOwn(record, key))
    ? record
    : null;
}

function uint32(value: unknown, allowZero = true): value is number {
  return Number.isInteger(value)
    && Number(value) >= (allowZero ? 0 : 1)
    && Number(value) <= 0xffff_ffff;
}

function exactStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function functionEvidence(
  value: unknown,
  params: readonly string[],
  cursor: boolean,
): boolean {
  const record = exactRecord(
    value,
    cursor
      ? ["functionIndex", "params", "results", "existingTableSlot"]
      : ["functionIndex", "params", "results"],
  );
  return record !== null
    && uint32(record.functionIndex)
    && exactStrings(record.params, params)
    && exactStrings(record.results, [])
    && (!cursor || uint32(record.existingTableSlot));
}

function sameHooks(left: EnhancementHooks, right: EnhancementHooks): boolean {
  return left.tick === right.tick
    && left.cursor === right.cursor
    && left.ui === right.ui;
}

function sameCapabilities(
  left: EnhancementCapabilities,
  right: EnhancementCapabilities,
): boolean {
  return left.nativeCursor === right.nativeCursor
    && left.targetObservation === right.targetObservation
    && left.partyObservation === right.partyObservation
    && left.teamApply === right.teamApply
    && left.travelAction === right.travelAction
    && left.xunlaiAction === right.xunlaiAction
    && left.chatAliases === right.chatAliases;
}

export function decodeEnhancementManifest(
  module: WebAssembly.Module,
  expectedCapabilities?: EnhancementCapabilities,
): EnhancementManifest | null {
  const sections = WebAssembly.Module.customSections(module, "enhancement_manifest");
  if (sections.length !== 1) return null;
  try {
    const value = exactRecord(
      JSON.parse(new TextDecoder().decode(sections[0])),
      [
        "transformAbi",
        "programId",
        "buildId",
        "tableSlot",
        "capabilities",
        "hooks",
        "messages",
        "configWords",
      ],
    );
    if (value === null) return null;
    const capabilityRecord = exactRecord(value.capabilities, [
      "nativeCursor",
      "targetObservation",
      "partyObservation",
      "teamApply",
      "travelAction",
      "xunlaiAction",
      "chatAliases",
    ]);
    const hooks = exactRecord(value.hooks, ["tick", "cursor", "ui"]);
    if (
      capabilityRecord === null
      || hooks === null
      || typeof capabilityRecord.nativeCursor !== "boolean"
      || typeof capabilityRecord.targetObservation !== "boolean"
      || typeof capabilityRecord.partyObservation !== "boolean"
      || typeof capabilityRecord.teamApply !== "boolean"
      || typeof capabilityRecord.travelAction !== "boolean"
      || typeof capabilityRecord.xunlaiAction !== "boolean"
      || typeof capabilityRecord.chatAliases !== "boolean"
    ) {
      return null;
    }

    const capabilities: EnhancementCapabilities = Object.freeze({
      nativeCursor: capabilityRecord.nativeCursor,
      targetObservation: capabilityRecord.targetObservation,
      partyObservation: capabilityRecord.partyObservation,
      teamApply: capabilityRecord.teamApply,
      travelAction: capabilityRecord.travelAction,
      xunlaiAction: capabilityRecord.xunlaiAction,
      chatAliases: capabilityRecord.chatAliases,
    });
    const selectedHooks: EnhancementHooks = Object.freeze({
      tick: hooks.tick !== null,
      cursor: hooks.cursor !== null,
      ui: hooks.ui !== null,
    });
    const expectedHooks = enhancementHooksFor(capabilities);
    const configWords = value.configWords;
    const messages = capabilities.partyObservation
      ? exactRecord(value.messages, [
          "playerChat",
          "hideHeroPanel",
          "showHeroPanel",
          "partyDirty",
        ])
      : null;
    const partyDirty = messages?.partyDirty;
    if (
      value.transformAbi !== ENHANCEMENT_TRANSFORM_ABI
      || !uint32(value.buildId, false)
      || !uint32(value.programId, false)
      || !uint32(value.tableSlot)
      || !enhancementCapabilitiesRequested(capabilities)
      || !sameHooks(selectedHooks, expectedHooks)
      || !Array.isArray(configWords)
      || configWords.length !== ENHANCEMENT_CONFIG_WORD_COUNT
      || configWords.some((word: unknown) => !uint32(word))
      || configWords.some(
        (word: unknown, index: number) =>
          !enhancementConfigWordActive(capabilities, index) && word !== 0,
      )
      || (hooks.tick !== null
        && !functionEvidence(hooks.tick, ["i32"], false))
      || (hooks.cursor !== null
        && !functionEvidence(
          hooks.cursor,
          ["i32", "i32", "i32", "i32", "i32"],
          true,
        ))
      || (hooks.ui !== null
        && !functionEvidence(hooks.ui, ["i32", "i32", "i32"], false))
      || (!capabilities.partyObservation && value.messages !== null)
      || (capabilities.partyObservation
        && (
          messages === null
          || ![
            messages.playerChat,
            messages.hideHeroPanel,
            messages.showHeroPanel,
          ].every((message) => uint32(message, false))
          || !Array.isArray(partyDirty)
          || partyDirty.length !== ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT
          || !partyDirty.every((message: unknown) => uint32(message, false))
          || new Set([
            messages.playerChat,
            messages.hideHeroPanel,
            messages.showHeroPanel,
            ...partyDirty,
          ]).size !== ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT + 3
          || configWords[MESSAGE_CONFIG_START] !== messages.playerChat
          || configWords[MESSAGE_CONFIG_START + 1] !== messages.hideHeroPanel
          || configWords[MESSAGE_CONFIG_START + 2] !== messages.showHeroPanel
          || partyDirty.some(
            (message: number, index: number) =>
              configWords[PARTY_DIRTY_CONFIG_START + index] !== message,
          )
        ))
      || (expectedCapabilities !== undefined
        && !sameCapabilities(capabilities, expectedCapabilities))
    ) {
      return null;
    }
    return Object.freeze({
      buildId: Number(value.buildId),
      programId: Number(value.programId),
      tableSlot: Number(value.tableSlot),
      capabilities,
      hooks: selectedHooks,
      configWords: Object.freeze(configWords.map(Number)),
    });
  } catch {
    return null;
  }
}
