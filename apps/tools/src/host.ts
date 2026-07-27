import { demoLibrary } from "./fixtures";
import { cloneLibrary, type Build, type BuildLibrary } from "./model";

export type PublishedTemplate = Readonly<{
  fileName: string;
  location: string;
}>;

export interface ToolsHost {
  readonly label: string;
  loadLibrary(): Promise<BuildLibrary>;
  saveLibrary(library: BuildLibrary): Promise<BuildLibrary>;
  publishBuild(build: Build): Promise<PublishedTemplate>;
  reset?(): Promise<BuildLibrary>;
}

const STORAGE_KEY = "gwonmac.tools.demo.library.v1";

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
      const value: unknown = JSON.parse(saved);
      if (
        typeof value === "object"
        && value !== null
        && "version" in value
        && value.version === 1
        && "builds" in value
        && Array.isArray(value.builds)
        && "teams" in value
        && Array.isArray(value.teams)
      ) {
        return cloneLibrary(value as BuildLibrary);
      }
    } catch {
      storage.removeItem(STORAGE_KEY);
    }
    return cloneLibrary(memory);
  };
  return {
    label: storage ? "Local demo data" : "Session demo data",
    async loadLibrary() {
      memory = read();
      return cloneLibrary(memory);
    },
    async saveLibrary(library) {
      memory = cloneLibrary(library);
      storage?.setItem(STORAGE_KEY, JSON.stringify(memory));
      return cloneLibrary(memory);
    },
    async publishBuild(build) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return {
        fileName: safeFileName(build.name),
        location: "Templates/Skills",
      };
    },
    async reset() {
      storage?.removeItem(STORAGE_KEY);
      memory = cloneLibrary(demoLibrary);
      return cloneLibrary(memory);
    },
  };
}
