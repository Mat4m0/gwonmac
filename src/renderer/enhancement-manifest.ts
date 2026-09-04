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
  ENHANCEMENT_EFFECT_DIRTY_MESSAGE_COUNT,
  ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT,
  ENHANCEMENT_TRANSFORM_ABI,
  enhancementConfigWordActive,
  enhancementHooksFor,
  parseEnhancementCapabilities,
  sameEnhancementCapabilities,
  type EnhancementCapabilities,
  type EnhancementHooks,
} from "../shared/enhancement-contracts.js";
import {
  ENHANCEMENT_DISPATCHER_CONFIG_START,
  ENHANCEMENT_EFFECT_DIRTY_CONFIG_START,
  ENHANCEMENT_PARTY_DIRTY_CONFIG_START,
} from "../shared/enhancement-config.js";

const MESSAGE_CONFIG_START = ENHANCEMENT_DISPATCHER_CONFIG_START;
const PARTY_DIRTY_CONFIG_START = ENHANCEMENT_PARTY_DIRTY_CONFIG_START;

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
    const capabilities = parseEnhancementCapabilities(value.capabilities);
    const hooks = exactRecord(value.hooks, ["tick", "cursor", "ui"]);
    if (
      capabilities === null
      || hooks === null
    ) {
      return null;
    }

    const selectedHooks: EnhancementHooks = Object.freeze({
      tick: hooks.tick !== null,
      cursor: hooks.cursor !== null,
      ui: hooks.ui !== null,
    });
    const expectedHooks = enhancementHooksFor(capabilities);
    const configWords = value.configWords;
    const messages = selectedHooks.ui
      ? exactRecord(value.messages, [
          "playerChat",
          "hideHeroPanel",
          "showHeroPanel",
          "partyDirty",
          "effectDirty",
        ])
      : null;
    const partyDirty = messages?.partyDirty;
    const effectDirty = messages?.effectDirty;
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
      || (!selectedHooks.ui && value.messages !== null)
      || (selectedHooks.ui
        && (
          messages === null
          || ![
            messages.playerChat,
            messages.hideHeroPanel,
            messages.showHeroPanel,
          ].every((message) => uint32(message, false))
          || !Array.isArray(partyDirty)
          || partyDirty.length !== (capabilities.partyObservation
            ? ENHANCEMENT_PARTY_DIRTY_MESSAGE_COUNT
            : 0)
          || !partyDirty.every((message: unknown) => uint32(message, false))
          || !Array.isArray(effectDirty)
          || effectDirty.length !== (capabilities.playerEffectObservation
            ? ENHANCEMENT_EFFECT_DIRTY_MESSAGE_COUNT
            : 0)
          || !effectDirty.every((message: unknown) => uint32(message, false))
          || new Set([
            messages.playerChat,
            messages.hideHeroPanel,
            messages.showHeroPanel,
            ...partyDirty,
            ...effectDirty,
          ]).size !== partyDirty.length + effectDirty.length + 3
          || (capabilities.partyObservation
            && (configWords[MESSAGE_CONFIG_START] !== messages.playerChat
              || configWords[MESSAGE_CONFIG_START + 1] !== messages.hideHeroPanel
              || configWords[MESSAGE_CONFIG_START + 2] !== messages.showHeroPanel))
          || (capabilities.partyObservation && partyDirty.some(
            (message: number, index: number) =>
              configWords[PARTY_DIRTY_CONFIG_START + index] !== message,
          ))
          || (capabilities.playerEffectObservation && effectDirty.some(
            (message: number, index: number) =>
              configWords[ENHANCEMENT_EFFECT_DIRTY_CONFIG_START + index] !== message,
          ))
        ))
      || (expectedCapabilities !== undefined
        && !sameEnhancementCapabilities(capabilities, expectedCapabilities))
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
