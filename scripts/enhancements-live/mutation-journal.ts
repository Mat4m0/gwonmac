import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type MutationJournalPhase = "prepared" | "mutated" | "restored";

export type MutationJournal = Readonly<{
  version: 1;
  scenario: string;
  clientBuild: number;
  mapId: number;
  phase: MutationJournalPhase;
  before: unknown;
  planned: unknown;
  lastAcknowledgedStep: number;
  updatedAt: string;
}>;

const journalDirectory = path.resolve(
  "test-results",
  "enhancements-live",
);
export const MUTATION_JOURNAL_PATH = path.join(
  journalDirectory,
  "mutation-journal.json",
);

function validJournal(value: unknown): value is MutationJournal {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.scenario === "string" &&
    Number.isSafeInteger(record.clientBuild) &&
    Number(record.clientBuild) > 0 &&
    Number.isSafeInteger(record.mapId) &&
    Number(record.mapId) > 0 &&
    ["prepared", "mutated", "restored"].includes(String(record.phase)) &&
    Number.isSafeInteger(record.lastAcknowledgedStep) &&
    Number(record.lastAcknowledgedStep) >= 0 &&
    typeof record.updatedAt === "string" &&
    "before" in record &&
    "planned" in record
  );
}

export async function readMutationJournal(
  journalPath = MUTATION_JOURNAL_PATH,
): Promise<MutationJournal | null> {
  try {
    const value: unknown = JSON.parse(
      await readFile(journalPath, "utf8"),
    );
    if (!validJournal(value)) {
      throw new Error("mutation journal is malformed");
    }
    return Object.freeze(value);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function assertMutationRecoveryClear(
  journalPath = MUTATION_JOURNAL_PATH,
): Promise<void> {
  const journal = await readMutationJournal(journalPath);
  if (journal && journal.phase !== "restored") {
    throw new Error(
      `unfinished mutation journal: ${journal.scenario} is ${journal.phase} `
        + `after ${journal.lastAcknowledgedStep} acknowledged steps`,
    );
  }
}

async function persist(
  journal: MutationJournal,
  journalPath = MUTATION_JOURNAL_PATH,
): Promise<void> {
  await mkdir(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  const temporary = `${journalPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, journalPath);
}

export async function prepareMutationJournal(
  input: Omit<MutationJournal, "version" | "phase" | "lastAcknowledgedStep" | "updatedAt">,
  journalPath = MUTATION_JOURNAL_PATH,
): Promise<void> {
  await assertMutationRecoveryClear(journalPath);
  await persist(Object.freeze({
    version: 1,
    ...input,
    phase: "prepared",
    lastAcknowledgedStep: 0,
    updatedAt: new Date().toISOString(),
  }), journalPath);
}

export async function advanceMutationJournal(
  phase: Exclude<MutationJournalPhase, "prepared">,
  lastAcknowledgedStep: number,
  journalPath = MUTATION_JOURNAL_PATH,
): Promise<void> {
  const current = await readMutationJournal(journalPath);
  if (!current || current.phase === "restored") {
    throw new Error("no active mutation journal");
  }
  if (!Number.isSafeInteger(lastAcknowledgedStep) || lastAcknowledgedStep < 0) {
    throw new Error("invalid mutation acknowledgement count");
  }
  await persist(Object.freeze({
    ...current,
    phase,
    lastAcknowledgedStep,
    updatedAt: new Date().toISOString(),
  }), journalPath);
}
