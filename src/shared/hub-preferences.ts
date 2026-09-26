/**
 * Bounded search phrases and pins. Entries reference canonical objects, never executable text.
 * Keeps presentation separate from canonical game and storage owners.
 */
import { normaliseHubQuery } from './hub.js';
export type HubShortcut = Readonly<{ id: string; phrase: string; pinned: boolean }>;
export const HUB_SHORTCUT_LIMIT = 64;
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
    if (typeof id !== 'string' || id.length > 240 || !/^(travel|builds|trade|whispers|character|storage|maps|place:\d+|team:.+|build:.+)$/u.test(id)
      || typeof phrase !== 'string' || phrase.length > 64 || /[\p{C}]/u.test(phrase) || typeof pinned !== 'boolean') return false;
    const term = normaliseHubQuery(phrase);
    if (ids.has(id) || (term && phrases.has(term))) return false;
    ids.add(id); if (term) phrases.add(term); return true;
  });
}
