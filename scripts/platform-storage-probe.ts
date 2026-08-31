/** Probe the real atomic writer and split-root layout on one disposable filesystem. */
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  sweepOrphans,
  writeAtomic,
  writeAtomicExclusive,
} from "../src/main/core/atomic-file.js";
import {
  gamePaths,
  type ApplicationStorageRoots,
} from "../src/main/core/paths.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a directory`);
  }
  return value;
}

const base = path.resolve(argument("--base") ?? tmpdir());
await access(base);
const fixture = await mkdtemp(path.join(base, "gwonmac-storage-probe-"));
const keep = process.argv.includes("--keep");
let passed = false;
globalThis.console.log(`Storage probe fixture: ${fixture}`);

try {
  const storage: ApplicationStorageRoots = {
    config: path.join(fixture, "config"),
    data: path.join(fixture, "data"),
    cache: path.join(fixture, "cache"),
    state: path.join(fixture, "state"),
    logs: path.join(fixture, "logs"),
    sessions: path.join(fixture, "sessions"),
  };
  const paths = gamePaths(storage);

  await writeAtomic(paths.settings, '{"revision":1}\n', 0o600);
  await writeAtomic(paths.settings, '{"revision":2}\n', 0o600);
  assert.equal(await readFile(paths.settings, "utf8"), '{"revision":2}\n');

  const exclusive = path.join(paths.multiRoot, "workspace.json");
  const publications = await Promise.allSettled([
    writeAtomicExclusive(exclusive, "first", 0o600),
    writeAtomicExclusive(exclusive, "second", 0o600),
  ]);
  assert.equal(
    publications.filter((result) => result.status === "fulfilled").length,
    1,
    "exactly one exclusive publication must win",
  );

  const unicodeDirectory = path.join(
    paths.storage.data,
    `Ü-${"long-segment-".repeat(12)}`,
  );
  const unicodeDocument = path.join(unicodeDirectory, "日本語-profile.json");
  await writeAtomic(unicodeDocument, "unicode", 0o600);
  assert.equal(await readFile(unicodeDocument, "utf8"), "unicode");

  const held = await open(paths.settings, "r");
  let replaceWhileOpen: "passed" | "refused";
  try {
    await writeAtomic(paths.settings, '{"revision":3}\n', 0o600);
    replaceWhileOpen = "passed";
  } catch {
    replaceWhileOpen = "refused";
  } finally {
    await held.close();
  }

  const caseUpper = path.join(paths.storage.state, "Case-Probe");
  const caseLower = path.join(paths.storage.state, "case-probe");
  await writeAtomicExclusive(caseUpper, "upper", 0o600);
  const caseDistinct = await writeAtomicExclusive(caseLower, "lower", 0o600)
    .then(() => true, () => false);

  await mkdir(paths.storage.logs, { recursive: true });
  const orphan = path.join(
    paths.storage.logs,
    "probe.json.99999999.deadbeef.tmp",
  );
  await writeFile(orphan, "orphan", "utf8");
  assert.equal(await sweepOrphans(paths.storage.logs), 1);

  const filesystem = await statfs(fixture);
  passed = true;
  globalThis.console.log(JSON.stringify({
    platform: process.platform,
    filesystem: {
      type: filesystem.type,
      blockSize: filesystem.bsize,
    },
    results: {
      atomicReplace: "passed",
      exclusiveCreate: "passed",
      unicodeLongPath: "passed",
      replaceWhileOpen,
      caseDistinct,
      orphanRecovery: "passed",
    },
    unproven: [
      "power-loss durability",
      "disk-full publication",
      "antivirus deny-delete locks",
      "reboot durability",
    ],
  }, null, 2));
} finally {
  if (passed && !keep) {
    await rm(fixture, { recursive: true, force: true });
  } else {
    globalThis.console.log(`Storage probe retained: ${fixture}`);
  }
}
