/**
 * Names a skill the way the game's own descriptions do ("Axe Attack",
 * "Flash Enchantment Spell"). The type, weapon, combo and flash fields follow
 * GWCA's skill layout and GWToolbox++'s \`SkillListingWindow\` labels; each was
 * checked against known skills in the current client.
 */
import { PROFESSIONS } from "../../shared/builds/heroes.js";
import type { SkillType } from "../../shared/skill-catalogue.js";
import type { SkillRecord } from "./skill-table.js";

const WEAPONS: Readonly<Record<number, SkillType>> = {
  1: "Axe Attack", 2: "Bow Attack", 8: "Dagger Attack", 16: "Hammer Attack", 32: "Scythe Attack",
  64: "Spear Attack", 70: "Ranged Attack", 128: "Sword Attack",
};
const COMBOS: Readonly<Record<number, SkillType>> = { 1: "Lead Attack", 2: "Off-Hand Attack", 3: "Dual Attack" };
const TYPES: Readonly<Record<number, SkillType>> = {
  3: "Stance", 4: "Hex Spell", 5: "Spell", 7: "Signet", 9: "Well Spell", 11: "Ward Spell", 12: "Glyph",
  15: "Shout", 19: "Preparation", 20: "Pet Attack", 21: "Trap", 24: "Item Spell", 25: "Weapon Spell",
  26: "Form", 27: "Chant", 28: "Echo", 29: "Disguise",
};

export function skillType(skill: Pick<SkillRecord, "type" | "flash" | "weaponRequirement" | "combo" | "profession">): SkillType {
  if (skill.type === 6) return skill.flash ? "Flash Enchantment Spell" : "Enchantment Spell";
  if (skill.type === 14) {
    if (skill.weaponRequirement === 8) return COMBOS[skill.combo] ?? "Dagger Attack";
    return WEAPONS[skill.weaponRequirement] ?? "Melee Attack";
  }
  // Rituals without a Ritualist or Ranger belong to the Ebon Vanguard.
  if (skill.type === 22) return skill.profession === PROFESSIONS.Rt.id ? "Binding Ritual"
    : skill.profession === PROFESSIONS.R.id ? "Nature Ritual" : "Ebon Vanguard Ritual";
  // Plain skills (10 and 16), such as Troll Unguent and Hundred Blades, and
  // records outside this vocabulary are shown as the game's generic "Skill".
  return TYPES[skill.type] ?? "Skill";
}
