/**
 * Owns the ten canonical profession names and icons shared by Core and Tools.
 * Numeric IDs stay identical to the game record and no caller keeps a second map.
 */
const PROFESSION_NAMES = Object.freeze([
  "", "Warrior", "Ranger", "Monk", "Necromancer", "Mesmer",
  "Elementalist", "Assassin", "Ritualist", "Paragon", "Dervish",
] as const);

const PROFESSION_ICONS = Object.freeze([
  "",
  new URL("./images/professions/1.png", import.meta.url).href,
  new URL("./images/professions/2.png", import.meta.url).href,
  new URL("./images/professions/3.png", import.meta.url).href,
  new URL("./images/professions/4.png", import.meta.url).href,
  new URL("./images/professions/5.png", import.meta.url).href,
  new URL("./images/professions/6.png", import.meta.url).href,
  new URL("./images/professions/7.png", import.meta.url).href,
  new URL("./images/professions/8.png", import.meta.url).href,
  new URL("./images/professions/9.png", import.meta.url).href,
  new URL("./images/professions/10.png", import.meta.url).href,
] as const);

export function professionPresentation(id: number): Readonly<{
  name: string;
  icon: string;
}> | null {
  if (!Number.isInteger(id) || id < 1 || id > 10) return null;
  return Object.freeze({
    name: PROFESSION_NAMES[id]!,
    icon: PROFESSION_ICONS[id]!,
  });
}
