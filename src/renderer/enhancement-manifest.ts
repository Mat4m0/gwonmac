const ENHANCEMENT_TRANSFORM_ABI = 8;
const CONFIG_WORDS = 39;

/** The validated subset of the derived module's fixed evidence. */
export type EnhancementManifest = Readonly<{
  buildId: number;
  programId: number;
  tableSlot: number;
  configWords: readonly number[];
}>;

export function decodeEnhancementManifest(
  module: WebAssembly.Module,
): EnhancementManifest | null {
  const sections = WebAssembly.Module.customSections(module, "enhancement_manifest");
  if (sections.length !== 1) return null;
  try {
    const value: Record<string, unknown> | null = JSON.parse(
      new TextDecoder().decode(sections[0]),
    );
    if (value === null) return null;
    const { buildId, programId, tableSlot, configWords } = value;
    const hooks = value.hooks as Record<string, unknown> | null;
    const messages = value.messages as Record<string, unknown> | null;
    const tick = hooks?.tick as Record<string, unknown> | null;
    const cursor = hooks?.cursor as Record<string, unknown> | null;
    const ui = hooks?.ui as Record<string, unknown> | null;
    if (
      value.transformAbi !== ENHANCEMENT_TRANSFORM_ABI
      || !Number.isSafeInteger(buildId)
      || Number(buildId) <= 0
      || !Number.isSafeInteger(programId)
      || Number(programId) <= 0
      || !Number.isSafeInteger(tableSlot)
      || Number(tableSlot) < 0
      || !Array.isArray(configWords)
      || configWords.length !== CONFIG_WORDS
      || configWords.some(
        (word: unknown) =>
          !Number.isInteger(word)
          || Number(word) < 0
          || Number(word) > 0xffff_ffff,
      )
      || !tick
      || !cursor
      || !ui
      || JSON.stringify(tick.params) !== JSON.stringify(["i32"])
      || JSON.stringify(cursor.params)
        !== JSON.stringify(["i32", "i32", "i32", "i32", "i32"])
      || JSON.stringify(ui.params) !== JSON.stringify(["i32", "i32", "i32"])
      || !messages
      || ![messages.playerChat, messages.hideHeroPanel, messages.showHeroPanel]
        .every((message) =>
          Number.isInteger(message)
          && Number(message) > 0
          && Number(message) <= 0xffff_ffff)
      || configWords[36] !== messages.playerChat
      || configWords[37] !== messages.hideHeroPanel
      || configWords[38] !== messages.showHeroPanel
    ) {
      return null;
    }
    return Object.freeze({
      buildId: Number(buildId),
      programId: Number(programId),
      tableSlot: Number(tableSlot),
      configWords: configWords.map(Number),
    });
  } catch {
    return null;
  }
}
