import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Independent OS tool used only to prove another ZIP implementation agrees. */
export async function extractZipNatively(
  archive: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  if (process.platform === "win32") {
    await execFileAsync("tar.exe", ["-xf", archive, "-C", destination]);
    return;
  }
  await execFileAsync("unzip", ["-qq", archive, "-d", destination]);
}
