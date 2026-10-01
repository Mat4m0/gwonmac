/**
 * Bounded search phrases and pins. Entries reference canonical objects, never executable text.
 * Keeps presentation separate from canonical game and storage owners.
 */
import { HUB_SCOPES, normaliseHubQuery } from './hub.js';
import { CURRENCY_ALIASES, calculate, parseConversion } from './hub-calculator.js';
/** First words that Hub's query grammar owns. */
export const HUB_RESERVED_WORDS: readonly string[] = [...HUB_SCOPES, 'settings', 'hub', 'commands', 'help', 'titles', 'rates', 'launcher'];
/** Whole phrases that the calculator reads as a unit. */
export const HUB_CALCULATOR_UNITS: readonly string[] = Object.keys(CURRENCY_ALIASES);
/**
 * What the query grammar reads a phrase as before any saved phrase: a command word first, a
 * calculator unit, or a calculation. Editing rejects these phrases; readers preserve stored
 * entries when a later release adds a word and simply stop matching them.
 */
export function hubPhraseReserved(phrase: string): 'command' | 'unit' | 'calculation' | null {
  const term = normaliseHubQuery(phrase);
  if (!term) return null;
  if (HUB_RESERVED_WORDS.includes(term.split(' ')[0]!)) return 'command';
  if (HUB_CALCULATOR_UNITS.includes(term)) return 'unit';
  try { return parseConversion(term) || calculate(term) ? 'calculation' : null; } catch { return /^\d/u.test(term) ? 'calculation' : null; }
}

export type HubShortcut = Readonly<{ id: string; phrase: string; pinned: boolean }>;
export const HUB_SHORTCUT_LIMIT = 64;
/** Build and team references stay with the account's library; other references stay in settings. */
export const isLibraryHubShortcut = (id: string): boolean => /^(build|team):/u.test(id);
/**
 * Structural validation for stored pins and phrases: shape, id, length and uniqueness.
 * Grammar words are refused only when a phrase is edited, so a phrase saved before a
 * new scope word or calculator unit keeps loading and simply stops matching.
 */
export function isHubShortcuts(value: unknown): value is readonly HubShortcut[] {
  if (!Array.isArray(value) || value.length > HUB_SHORTCUT_LIMIT) return false;
  const ids = new Set<string>(); const phrases = new Set<string>();
  return value.every(entry => {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !['id', 'phrase', 'pinned'].includes(key))) return false;
    if (!('id' in entry) || !('phrase' in entry) || !('pinned' in entry)) return false;
    const { id, phrase, pinned }: { id: unknown; phrase: unknown; pinned: unknown } = entry;
    if (typeof id !== 'string' || id.length > 240 || !/^(travel|builds|trade|whispers|character|storage|maps|settings|commands|accounts|place:\d+|team:.+|build:.+)$/u.test(id)
      || typeof phrase !== 'string' || phrase.length > 64 || /[\p{C}]/u.test(phrase) || typeof pinned !== 'boolean') return false;
    const term = normaliseHubQuery(phrase);
    if (ids.has(id) || (term && phrases.has(term))) return false;
    ids.add(id); if (term) phrases.add(term); return true;
  });
}
