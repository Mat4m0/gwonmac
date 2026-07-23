import { randomBytes } from "node:crypto";
import { rename, writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

function tempPath(target: string): string {
  const suffix = randomBytes(4).toString("hex");
  return `${target}.${process.pid}.${suffix}.tmp`;
}

export async function writeAtomic(
  path: string,
  data: string | Uint8Array,
  mode?: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tempPath(path);
  await writeFile(tmp, data);
  if (mode !== undefined) await chmod(tmp, mode);
  await rename(tmp, path);
}

export async function writeAtomicJson(
  path: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  await writeAtomic(path, JSON.stringify(value), mode);
}

/** Chunk publication: write under a unique temp name in the same directory, then rename. */
export async function writeAtomicInDir(
  dir: string,
  finalName: string,
  data: Uint8Array,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const finalPath = join(dir, finalName);
  const tmp = join(dir, `${finalName}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, finalPath);
  return finalPath;
}
