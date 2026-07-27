import type { GwNativeApi } from "../../../src/shared/contracts";
import { demoLibrary, demoSkillCatalogue } from "./fixtures";
import { cloneLibrary, type Build, type BuildLibrary } from "./model";
import type { SkillCatalogue } from "./skill-catalog";

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
  return {
    label: "Saved on this Mac",
    // Replaced by the local client catalogue during the asset milestone.
    skills: demoSkillCatalogue,
    loadLibrary: () => api.buildLibrary.get(),
    async saveLibrary(library) {
      await api.buildLibrary.set(library);
    },
    publishBuild,
  };
}
