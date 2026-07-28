import {
  open,
  readFile,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

type SessionState = "launching" | "connected" | "running" | "passed" | "failed";

type SessionRecord = Readonly<{
  version: 1;
  runnerPid: number;
  childPid: number | null;
  scenario: string;
  state: SessionState;
  endpoint: string | null;
  startedAt: string;
}>;

export function liveSessionPath(userData: string): string {
  return path.join(userData, "enhancements-live-session.json");
}

function validRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Number.isSafeInteger(record.runnerPid) &&
    Number(record.runnerPid) > 0 &&
    (record.childPid === null ||
      (Number.isSafeInteger(record.childPid) && Number(record.childPid) > 0)) &&
    typeof record.scenario === "string" &&
    ["launching", "connected", "running", "passed", "failed"].includes(
      String(record.state),
    ) &&
    (record.endpoint === null || typeof record.endpoint === "string") &&
    typeof record.startedAt === "string"
  );
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

async function staleRecord(sessionPath: string): Promise<SessionRecord> {
  const value: unknown = JSON.parse(await readFile(sessionPath, "utf8"));
  if (!validRecord(value)) {
    throw new Error(`live session lock is malformed: ${sessionPath}`);
  }
  return value;
}

async function writeRecord(
  handle: FileHandle,
  record: SessionRecord,
): Promise<void> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
  await handle.write(bytes, 0, bytes.length, 0);
  await handle.truncate(bytes.length);
  await handle.sync();
}

export async function acquireLiveSession(
  userData: string,
  scenario: string,
) {
  const sessionPath = liveSessionPath(userData);
  let handle: FileHandle;
  try {
    handle = await open(sessionPath, "wx", 0o600);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
    const previous = await staleRecord(sessionPath);
    const ownedPids = [previous.runnerPid, previous.childPid]
      .filter((pid): pid is number => pid !== null && processAlive(pid));
    if (ownedPids.length > 0) {
      throw new Error(
        `profile already has live scenario ${previous.scenario} `
          + `(${previous.state}); owned PID${ownedPids.length > 1 ? "s" : ""} `
          + ownedPids.join(", "),
        { cause: error },
      );
    }
    await unlink(sessionPath);
    handle = await open(sessionPath, "wx", 0o600);
  }

  let record: SessionRecord = Object.freeze({
    version: 1,
    runnerPid: process.pid,
    childPid: null,
    scenario,
    state: "launching",
    endpoint: null,
    startedAt: new Date().toISOString(),
  });
  await writeRecord(handle, record);
  let released = false;
  return Object.freeze({
    path: sessionPath,
    async update(
      patch: Partial<Pick<SessionRecord, "childPid" | "state" | "endpoint">>,
    ) {
      if (released) throw new Error("live session lock was already released");
      record = Object.freeze({ ...record, ...patch });
      await writeRecord(handle, record);
    },
    async release() {
      if (released) return;
      released = true;
      await handle.close();
      await unlink(sessionPath).catch((error: unknown) => {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      });
    },
  });
}
