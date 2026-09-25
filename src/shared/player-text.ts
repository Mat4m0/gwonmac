/**
 * Owns the cleanup of text a player copied from outside Guild Wars.
 * Game paste and character-name search share it, so a pasted name behaves
 * exactly like the same name typed by hand.
 */

// Web pages, Discord and word processors add invisible format characters
// (zero-width spaces and joiners, direction marks, byte-order marks, soft
// hyphens) and typographic spaces. Guild Wars compares names unit by unit.
const FORMAT_CHARACTERS = /\p{Cf}/gu;
const TYPOGRAPHIC_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f]/gu;

/** Removes invisible characters and surrounding whitespace from pasted text. */
export function cleanPastedText(value: string): string {
  return value.replace(FORMAT_CHARACTERS, "").replace(TYPOGRAPHIC_SPACES, " ").trim();
}

/** The name a player means: clean, with single spaces between words. */
export function normaliseCharacterName(value: string): string {
  return cleanPastedText(value).replace(/\s+/gu, " ");
}
