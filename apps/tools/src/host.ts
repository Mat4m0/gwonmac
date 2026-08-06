import { ref, type Ref } from "vue";
import {
  SKILL_CATALOGUE_ROUTE,
  SKILL_ICON_ROUTE,
  type GwNativeApi,
} from "../../../src/shared/contracts";
import {
  unavailableParty,
  type LiveParty,
} from "../../../src/shared/builds/live-party";
import {
  ATTRIBUTES,
  PROFESSIONS,
} from "../../../src/shared/builds/heroes";
import {
  skillId,
  type Attribute,
  type Profession,
} from "../../../src/shared/builds/library";
import type {
  TeamApplyPlan,
  TeamApplyResult,
} from "../../../src/shared/builds/team-apply";
import { encodeSkillTemplate } from "../../../src/shared/builds/skill-template";
import { demoLibrary, demoParty, demoSkillCatalogue } from "./fixtures";
import { cloneLibrary, type Build, type BuildLibrary } from "./model";
import {
  createSkillCatalogue,
  type SkillCatalogue,
  type SkillPresentation,
} from "./skill-catalog";

export type PublishedTemplate = Readonly<{
  fileName: string;
  location: string;
}>;

export type LibraryLoad = Readonly<{
  library: BuildLibrary;
  recovered: boolean;
  /**
   * Why the skill catalogue is missing, when it is. The library still opens —
   * saved builds stay readable and editable — but nothing new can be authored,
   * and that has to be said rather than shown as an empty picker.
   */
  skillProblem?: string;
}>;

export interface ToolsHost {
  readonly label: string;
  readonly skills: SkillCatalogue;
  /**
   * The party the player is actually in.
   *
   * The harness writes it as the companion publishes; the panel only reads. A
   * host with no running game behind it leaves it `unavailable`, which is a
   * state the interface has to draw anyway — the game is not always running,
   * and "not observed" is the honest thing to say when it is not.
   */
  readonly party: Ref<LiveParty>;
  loadLibrary(): Promise<LibraryLoad>;
  saveLibrary(library: BuildLibrary): Promise<void>;
  publishBuild(build: Build): Promise<PublishedTemplate>;
  applyTeam(plan: TeamApplyPlan): Promise<TeamApplyResult>;
  /**
   * Why `applyTeam` cannot reach the running game, or `null` when it can.
   *
   * The interface has to be able to say this before the click. A primary button
   * that looks ready and then refuses has already spent the player's decision
   * to press it, and reads as a broken panel rather than as a capability that
   * does not exist yet.
   */
  readonly applyUnavailable: string | null;
  reset?(): Promise<LibraryLoad>;
}

const STORAGE_KEY = "gwonmac.tools.demo.library.v2";

function safeFileName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
  return `${cleaned || "GWonMac Build"}.txt`;
}

export function createDemoHost(storage: Storage | null = null): ToolsHost {
  let memory = cloneLibrary(demoLibrary);
  const read = (): BuildLibrary => {
    if (!storage) return cloneLibrary(memory);
    const saved = storage.getItem(STORAGE_KEY);
    if (!saved) return cloneLibrary(memory);
    try {
      const value = JSON.parse(saved) as BuildLibrary;
      if (value.version === 2 && Array.isArray(value.builds) && Array.isArray(value.teams)) {
        return cloneLibrary(value);
      }
    } catch {
      storage.removeItem(STORAGE_KEY);
    }
    return cloneLibrary(memory);
  };
  return {
    label: storage ? "Local fixture library" : "Session fixture library",
    skills: demoSkillCatalogue,
    // Deliberately the *partial* shape the companion actually publishes today —
    // a hero count with one identified hero and no ordering. A fixture showing
    // a full roster would let this section be designed against data the running
    // game cannot yet supply, and the gap would surface as a bug report.
    party: ref(demoParty),
    // The fixture host answers its own apply, so it has nothing to refuse.
    applyUnavailable: null,
    async loadLibrary() {
      memory = read();
      return { library: cloneLibrary(memory), recovered: false };
    },
    async saveLibrary(library) {
      memory = cloneLibrary(library);
      storage?.setItem(STORAGE_KEY, JSON.stringify(memory));
    },
    async publishBuild(build) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return { fileName: safeFileName(build.name), location: "Templates/Skills" };
    },
    async applyTeam() {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return { commandId: 1, completedChanges: 0, skillsSkipped: false };
    },
    async reset() {
      storage?.removeItem(STORAGE_KEY);
      memory = cloneLibrary(demoLibrary);
      return { library: cloneLibrary(memory), recovered: false };
    },
  };
}

/**
 * A build already encoded as the text Guild Wars stores. The renderer writes
 * templates but does not own the codec: `src/shared/builds` is compiled into
 * this bundle and is deliberately not on the protocol's shared-module
 * allowlist, so the encoding happens here and the host receives a string.
 */
export type PublishableTemplate = Readonly<{ name: string; code: string }>;

export function createNativeHost(
  api: GwNativeApi,
  publishTemplate: (template: PublishableTemplate) => Promise<PublishedTemplate>,
  applyTeam: (plan: TeamApplyPlan) => Promise<TeamApplyResult>,
  applyUnavailable: string | null,
): ToolsHost {
  const skills = createSkillCatalogue([]);
  const profession = new Set<Profession>(
    Object.keys(PROFESSIONS) as Profession[],
  );
  const attribute = new Set<Attribute>(
    Object.keys(ATTRIBUTES) as Attribute[],
  );
  // Failures here are reported, never swallowed. A silently empty catalogue is
  // indistinguishable from a rendering bug, which is exactly how a missing
  // protocol route once cost an afternoon.
  const loadSkills = async () => {
    const response = await fetch(`gw://app/${SKILL_CATALOGUE_ROUTE}`);
    if (!response.ok) {
      throw new Error(
        `The skill catalogue is unavailable (${response.status}). Guild Wars `
        + "may still be downloading; the console records why.",
      );
    }
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) {
      throw new Error("The skill catalogue was not a list of skills.");
    }
    const parsed: SkillPresentation[] = [];
    for (const value of raw) {
      if (value === null || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (
        !Number.isSafeInteger(record.id)
        || typeof record.name !== "string"
        || typeof record.elite !== "boolean"
        || !["pve", "player-only-pve", "pvp", "not-equippable"].includes(String(record.availability))
        || typeof record.hasIcon !== "boolean"
        || (record.description !== null && typeof record.description !== "string")
        || ![
          "energyCost", "adrenalineCost", "healthCost", "overcast",
          "activationSeconds", "aftercastSeconds", "rechargeSeconds",
        ].every((field) => typeof record[field] === "number" && Number.isFinite(record[field]))
        || (record.profession !== null && !profession.has(record.profession as Profession))
        || (record.attribute !== null && !attribute.has(record.attribute as Attribute))
      ) {
        continue;
      }
      const id = skillId(record.id as number);
      parsed.push({
        id,
        name: record.name,
        profession: record.profession as Profession | null,
        attribute: record.attribute as Attribute | null,
        elite: record.elite,
        availability: record.availability as SkillPresentation["availability"],
        energyCost: record.energyCost as number,
        adrenalineCost: record.adrenalineCost as number,
        healthCost: record.healthCost as number,
        overcast: record.overcast as number,
        activationSeconds: record.activationSeconds as number,
        aftercastSeconds: record.aftercastSeconds as number,
        rechargeSeconds: record.rechargeSeconds as number,
        description: record.description as string | null,
        iconUrl: record.hasIcon ? `gw://app/${SKILL_ICON_ROUTE(id)}` : null,
      });
    }
    if (parsed.length === 0) {
      throw new Error("The skill catalogue arrived empty.");
    }
    skills.replace(parsed);
  };
  return {
    label: "Saved on this Mac",
    skills,
    party: ref(unavailableParty()),
    applyUnavailable,
    async loadLibrary() {
      const [library, skills] = await Promise.all([
        api.buildLibrary.get(),
        loadSkills().then(
          () => null,
          (cause: unknown) => {
            console.error("[tools] the skill catalogue did not load", cause);
            return cause instanceof Error
              ? cause.message
              : "The skill catalogue did not load.";
          },
        ),
      ]);
      return skills === null ? library : { ...library, skillProblem: skills };
    },
    async saveLibrary(library) {
      await api.buildLibrary.set(library);
    },
    async publishBuild(build) {
      const code = encodeSkillTemplate(build);
      if (code === null) {
        throw new Error("This build cannot be written as a template.");
      }
      return publishTemplate({ name: build.name, code });
    },
    applyTeam,
  };
}
