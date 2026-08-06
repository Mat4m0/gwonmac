/**
 * The skill catalogue the build editor authors against.
 *
 * One join: mechanics from the player's own client binary (`skill-table.ts`),
 * spelling from the committed vocabulary (`skill-names.ts`), equippability
 * from the audited allowlist (`equippable-skills.ts`). Nothing here reads the
 * game archive and nothing here spawns a helper process.
 *
 * ## Why no icons or description text
 *
 * Both live in `Gw.dat`, behind ArenaNet's own compression and, for icons, a
 * texture codec — about 2,100 lines of vendored C++, a `clang++` step in the
 * build, and four packaged resources. The editor is fully usable without
 * them: `SkillCatalogue.vue` renders a name-and-cost row when `iconUrl` is
 * null and shows its "description unavailable" branch beside it.
 *
 * So `hasIcon` is reported honestly as `false` rather than being dropped from
 * the wire shape. Serving real icons later is then a change to this file and
 * one protocol route, with no edit to the renderer at all.
 */

import { readFile } from "node:fs/promises";
import { ATTRIBUTE_BY_ID } from "../../shared/builds/heroes.js";
import { isKnownEquippableSkill } from "./equippable-skills.js";
import { skillName } from "./skill-names.js";
import { findSkillTable, type SkillRecord } from "./skill-table.js";

const PROFESSION = new Map<number, string>([
  [1, "W"], [2, "R"], [3, "Mo"], [4, "N"], [5, "Me"],
  [6, "E"], [7, "A"], [8, "Rt"], [9, "P"], [10, "D"],
]);

/**
 * Title ids below Codex are the account title tracks used by player-only PvE
 * skills. This is the same boundary the game's own team-build catalogue uses.
 */
const CODEX_TITLE_ID = 41;

export interface SkillFacts {
  readonly id: number;
  readonly name: string;
  readonly profession: string | null;
  readonly elite: boolean;
  readonly availability: "pve" | "player-only-pve" | "pvp" | "not-equippable";
  readonly attribute: string | null;
  readonly energyCost: number;
  readonly adrenalineCost: number;
  readonly healthCost: number;
  readonly overcast: number;
  readonly activationSeconds: number;
  readonly aftercastSeconds: number;
  readonly rechargeSeconds: number;
  readonly description: string | null;
  readonly hasIcon: boolean;
}

export function skillAvailability(
  skill: Pick<SkillRecord, "id" | "playable" | "pvp" | "pve" | "title">,
): SkillFacts["availability"] {
  if (skill.pvp) return "pvp";
  if (!skill.playable) return "not-equippable";
  if (skill.pve && skill.title < CODEX_TITLE_ID) return "player-only-pve";
  if (skill.pve || isKnownEquippableSkill(skill.id)) return "pve";
  return "not-equippable";
}

export function presentSkill(skill: SkillRecord): SkillFacts {
  return {
    id: skill.id,
    name: skillName(skill.id) ?? `Skill ${skill.id}`,
    profession: PROFESSION.get(skill.profession) ?? null,
    elite: skill.elite,
    availability: skillAvailability(skill),
    attribute: ATTRIBUTE_BY_ID.get(skill.attribute) ?? null,
    energyCost: skill.energyCost,
    adrenalineCost: skill.adrenalineCost,
    healthCost: skill.healthCost,
    overcast: skill.overcast,
    activationSeconds: skill.activationSeconds,
    aftercastSeconds: skill.aftercastSeconds,
    rechargeSeconds: skill.rechargeSeconds,
    description: null,
    hasIcon: false,
  };
}

/**
 * Why a client build yielded no catalogue. Both are recoverable and neither is
 * a defect: a client can be mid-download, and a future ArenaNet build could in
 * principle reshape the table past what `findSkillTable` recognises.
 */
export type CatalogueRefusal = "client-unreadable" | "table-not-found";

export type CatalogueRead =
  | { readonly ok: true; readonly skills: readonly SkillFacts[] }
  | { readonly ok: false; readonly reason: CatalogueRefusal };

/**
 * Read the catalogue out of a client binary. Never rejects — a failure is a
 * named refusal, so the caller can log which one without inspecting a message.
 *
 * Scanning for the table is the expensive part, so callers hold the returned
 * promise rather than calling this per request — see `catalogueFor` in
 * `protocol.ts`.
 */
export async function readSkillCatalogue(
  wasmPath: string,
): Promise<CatalogueRead> {
  let binary: Buffer;
  try {
    binary = await readFile(wasmPath);
  } catch {
    return { ok: false, reason: "client-unreadable" };
  }
  const table = findSkillTable(binary);
  if (!table) return { ok: false, reason: "table-not-found" };
  return { ok: true, skills: table.skills.map(presentSkill) };
}
