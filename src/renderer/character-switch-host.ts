/**
 * Keeps Command-E owned by Core even when the current game build is unsupported.
 * A certified installation may replace only the source, never shortcut ownership.
 */
import { matchHubRows, parseHubQuery, type HubSource } from '../shared/hub.js';
import { professionPresentation } from '../shared/profession-assets.js';
import { currentCharacterIndex, type CharacterSwitchSource } from "./character-switch-model.js";
import { createCharacterSwitchPalette } from "./character-switch-palette.js";

export interface CharacterSwitchHost {
  attach(source: CharacterSwitchSource): () => void;
  dispose(): void;
}

export function installCharacterSwitchHost(parent: HTMLElement): CharacterSwitchHost {
  const listeners = new Set<() => void>();
  const unavailable: CharacterSwitchSource = Object.freeze({
    characters: Object.freeze({ status: "waiting", reason: "memory" }),
    action: Object.freeze({
      status: "failed",
      code: "play-path-unproved",
      retryable: false,
    }),
    context: "unavailable",
    request() {},
    confirm() {},
    cancelConfirmation() {},
    reset() {},
    diagnostics: () => Object.freeze({ version: 1, stage: "unavailable", lastCode: "play-path-unproved" }),
    subscribe() { return () => {}; },
  });
  let source = unavailable;
  let detachSource = source.subscribe(() => { for (const listener of listeners) listener(); });
  const proxy: CharacterSwitchSource = Object.freeze({
    get characters() { return source.characters; },
    get action() { return source.action; },
    get context() { return source.context; },
    request(characterKey: string) { source.request(characterKey); },
    confirm() { source.confirm(); },
    cancelConfirmation() { source.cancelConfirmation(); },
    reset() { source.reset(); },
    diagnostics() { return source.diagnostics(); },
    subscribe(listener: () => void) { listeners.add(listener); listener(); return () => { listeners.delete(listener); }; },
  });
  const palette = createCharacterSwitchPalette(parent, proxy);
  const hubSource: HubSource = {
    feature: 'characterSwitchEnabled',
    context() {
      const state = source.characters;
      return ['outpost', 'pve-explorable', 'pvp-explorable'].includes(source.context) && state.status === 'ready' && state.selectedIndex !== null
        ? state.characters[state.selectedIndex]?.name ?? null : null;
    },
    setVisible() {}, subscribe: proxy.subscribe,
    search(query) {
      const parsed = parseHubQuery(query);
      if ((parsed.scope && parsed.scope !== 'char') || !parsed.term || source.characters.status !== 'ready') return [];
      const characters = source.characters;
      return matchHubRows(characters.characters.map((character, index) => {
        const current = index === currentCharacterIndex(source);
        return { id: `character:${character.characterKey}`, title: character.name,
          ...(professionPresentation(character.primaryProfession) ? { icon: professionPresentation(character.primaryProfession)!.icon } : {}),
          detail: `${professionPresentation(character.primaryProfession)?.name ?? ''} · Level ${character.level}`,
          keywords: professionPresentation(character.primaryProfession)?.name ?? '', group: 'Characters', action: current ? 'Current character' : `Switch to ${character.name}`,
          ...(current ? { unavailable: 'Current character' } : {}),
          run: () => {
            const refusal = palette.activate(character.characterKey);
            if (refusal) throw refusal;
          },
        };
      }), parsed.term);
    },
  };
  const detachHub = window.gwHub?.attach(hubSource);
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
    dispose() { detachHub?.(); detachSource(); listeners.clear(); palette.dispose(); },
  });
}
