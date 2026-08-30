/**
 * Keeps Command-R owned by Core even when the current game build is unsupported.
 * A certified installation may replace only the source, never shortcut ownership.
 */
import type { CharacterSwitchSource } from "./character-switch-palette.js";
import { createCharacterSwitchPalette } from "./character-switch-palette.js";
import { EMPTY_CHARACTER_SWITCH_USAGE } from "../shared/character-switch-usage.js";

export interface CharacterSwitchHost {
  attach(source: CharacterSwitchSource): () => void;
  dispose(): void;
}

export function installCharacterSwitchHost(parent: HTMLElement): CharacterSwitchHost {
  const listeners = new Set<() => void>();
  const unavailable: CharacterSwitchSource = Object.freeze({
    characters: Object.freeze({ status: "waiting", reason: "memory" }),
    action: Object.freeze({ status: "failed", code: "play-path-unproved" }),
    usage: EMPTY_CHARACTER_SWITCH_USAGE,
    context: "unavailable",
    request() {},
    reset() {},
    diagnostics: () => Object.freeze({ version: 1, stage: "unavailable", lastCode: "play-path-unproved" }),
    subscribe() { return () => {}; },
  });
  let source = unavailable;
  let detachSource = source.subscribe(() => { for (const listener of listeners) listener(); });
  const proxy: CharacterSwitchSource = Object.freeze({
    get characters() { return source.characters; },
    get action() { return source.action; },
    get usage() { return source.usage; },
    get context() { return source.context; },
    request(sequence: number, index: number, explorableConfirmed?: boolean) {
      source.request(sequence, index, explorableConfirmed);
    },
    reset() { source.reset(); },
    diagnostics() { return source.diagnostics(); },
    subscribe(listener: () => void) { listeners.add(listener); listener(); return () => { listeners.delete(listener); }; },
  });
  const palette = createCharacterSwitchPalette(parent, proxy);
  return Object.freeze({
    attach(next: CharacterSwitchSource) {
      detachSource();
      source = next;
      detachSource = source.subscribe(() => { for (const listener of listeners) listener(); });
      for (const listener of listeners) listener();
      return () => {
        if (source !== next) return;
        detachSource();
        source = unavailable;
        detachSource = source.subscribe(() => { for (const listener of listeners) listener(); });
        for (const listener of listeners) listener();
      };
    },
    dispose() { detachSource(); listeners.clear(); palette.dispose(); },
  });
}
