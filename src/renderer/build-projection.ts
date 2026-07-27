import type { Build } from "../shared/builds/library.js";
import { encodeSkillTemplate } from "../shared/builds/skill-template.js";

// The filesystem host changes into the `app:` IDBFS mount before the game is
// released. Game-facing operations must therefore use the same relative path
// the client uses; spelling the mount name again resolves beneath the working
// directory in the live Emscripten runtime.
export const TEMPLATE_DIRECTORY = "Templates/Skills";
const TEMPLATE_MODE = 0o600;
const MAX_NAME = 64;
const REJECTED = new Set([...'.*:/<>|"?\\']);
const SYNC_TIMEOUT_MS = 30_000;

type TemplateFileSystem = {
  readdir(path: string): string[];
  writeFile(
    path: string,
    data: string,
    options: { mode: number },
  ): void;
  syncfs(populate: false, callback: (error?: unknown) => void): void;
};

type EmscriptenRuntime = typeof globalThis & {
  FS?: TemplateFileSystem;
};

export function templateFileName(name: string): string | null {
  let cleaned = "";
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 32 && !REJECTED.has(character)) cleaned += character;
  }
  cleaned = cleaned.replace(/^[\s.]+/u, "").replace(/\s+$/u, "");
  return cleaned.length > 0 && cleaned.length <= MAX_NAME ? cleaned : null;
}

export function existingTemplateNames(fs: TemplateFileSystem): string[] {
  return fs.readdir(TEMPLATE_DIRECTORY)
    .filter((entry) => entry !== "." && entry !== "..")
    .filter((entry) => entry.toLocaleLowerCase().endsWith(".txt"))
    .map((entry) => entry.slice(0, -4));
}

export function uniqueTemplateName(
  taken: Iterable<string>,
  desired: string,
): string | null {
  const used = new Set(taken);
  if (!used.has(desired)) return desired;
  for (let suffix = 2; suffix < 1_000; suffix++) {
    const candidate = `${desired} (${suffix})`;
    if (!used.has(candidate)) {
      return candidate.length <= MAX_NAME ? candidate : null;
    }
  }
  return null;
}

function persist(fs: TemplateFileSystem): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Template persistence timed out.")),
      SYNC_TIMEOUT_MS,
    );
    fs.syncfs(false, (error) => {
      clearTimeout(timer);
      if (error) reject(new Error("The template could not be persisted."));
      else resolve();
    });
  });
}

/**
 * Projects the library's canonical build into the game's own template folder.
 * This sends no input: the player still chooses the template from Guild Wars.
 */
export async function publishBuildTemplate(
  build: Build,
): Promise<{ fileName: string; location: string }> {
  const fs = (globalThis as EmscriptenRuntime).FS;
  if (!fs) throw new Error("Guild Wars is not ready to receive templates.");
  const code = encodeSkillTemplate(build);
  if (code === null) throw new Error("This build cannot be encoded as a Guild Wars template.");
  const desired = templateFileName(build.name);
  if (desired === null) throw new Error("Choose a shorter template name with ordinary characters.");
  const name = uniqueTemplateName(existingTemplateNames(fs), desired);
  if (name === null) throw new Error("No safe template filename is available.");
  fs.writeFile(`${TEMPLATE_DIRECTORY}/${name}.txt`, code, { mode: TEMPLATE_MODE });
  await persist(fs);
  return { fileName: `${name}.txt`, location: "Templates/Skills" };
}
