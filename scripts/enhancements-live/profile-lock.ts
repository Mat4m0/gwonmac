/** Detects a live Electron owner for the exact profile a live run would use. */
import { readlink } from "node:fs/promises";
import path from "node:path";

type ProcessProbe = (pid: number) => void;

export async function activeProfileOwner(
  userData: string,
  probe: ProcessProbe = (pid) => process.kill(pid, 0),
): Promise<number | null> {
  let target: string;
  try {
    target = await readlink(path.join(userData, "SingletonLock"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const match = /-(\d+)$/u.exec(target);
  const pid = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    probe(pid);
    return pid;
  } catch (error) {
    // ESRCH means the lock is stale. Permission refusal is conservative proof
    // that another live process owns the PID even though it cannot be signaled.
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? null : pid;
  }
}
