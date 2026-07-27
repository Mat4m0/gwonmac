import type { GwNativeApi } from "../../../src/shared/contracts";
import {
  ATTRIBUTES,
  PROFESSIONS,
} from "../../../src/shared/builds/heroes";
import {
  skillId,
  type Attribute,
  type Profession,
} from "../../../src/shared/builds/library";
import { demoLibrary, demoSkillCatalogue } from "./fixtures";
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
}>;

export interface ToolsHost {
  readonly label: string;
  readonly skills: SkillCatalogue;
  loadLibrary(): Promise<LibraryLoad>;
  saveLibrary(library: BuildLibrary): Promise<void>;
  publishBuild(build: Build): Promise<PublishedTemplate>;
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
    async reset() {
      storage?.removeItem(STORAGE_KEY);
      memory = cloneLibrary(demoLibrary);
      return { library: cloneLibrary(memory), recovered: false };
    },
  };
}

export function createNativeHost(
  api: GwNativeApi,
  publishBuild: (build: Build) => Promise<PublishedTemplate>,
): ToolsHost {
  const skills = createSkillCatalogue([]);
  const profession = new Set<Profession>(
    Object.keys(PROFESSIONS) as Profession[],
  );
  const attribute = new Set<Attribute>(
    Object.keys(ATTRIBUTES) as Attribute[],
  );
  const loadSkills = async () => {
    const response = await fetch("gw://app/skill-catalog.json");
    if (!response.ok) return;
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) return;
    const parsed: SkillPresentation[] = [];
    for (const value of raw) {
      if (value === null || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (
        !Number.isSafeInteger(record.id)
        || typeof record.name !== "string"
        || typeof record.elite !== "boolean"
        || typeof record.playable !== "boolean"
        || typeof record.hasIcon !== "boolean"
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
        playable: record.playable,
        iconUrl: record.hasIcon ? `gw://app/skill-icons/${id}.bmp` : null,
      });
    }
    skills.replace(parsed);
  };
  return {
    label: "Saved on this Mac",
    skills,
    async loadLibrary() {
      const [library] = await Promise.all([
        api.buildLibrary.get(),
        loadSkills().catch(() => undefined),
      ]);
      return library;
    },
    async saveLibrary(library) {
      await api.buildLibrary.set(library);
    },
    publishBuild,
  };
}
