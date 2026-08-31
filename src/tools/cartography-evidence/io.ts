/**
 * Reads the one declared Cartography report from JSON or a diagnostics ZIP
 * and writes owner-only deterministic tool output.
 */
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { CartographyEvidenceReport } from "../../shared/cartography-evidence.js";
import {
  canonicalCartographyJson,
  parseCartographyEvidence,
} from "../../main/cartography-evidence/report.js";

const execFileAsync = promisify(execFile);
const MAX_REPORT_BYTES = 4 * 1024 * 1024;

function parseDocument(bytes: Buffer): CartographyEvidenceReport {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REPORT_BYTES) {
    throw new Error("Cartography evidence document size is invalid");
  }
  return parseCartographyEvidence(JSON.parse(bytes.toString("utf8")));
}

export async function readCartographyEvidence(
  input: string,
): Promise<CartographyEvidenceReport> {
  if (/\.json$/iu.test(input)) return parseDocument(await readFile(input));
  const { stdout } = await execFileAsync(
    "/usr/bin/unzip",
    ["-p", input, "cartography-report.json"],
    { encoding: "buffer", maxBuffer: MAX_REPORT_BYTES + 1 },
  );
  return parseDocument(stdout);
}

export async function writeCartographyJson(output: string, value: unknown): Promise<void> {
  await writeFile(output, `${canonicalCartographyJson(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function writeCartographyPng(
  output: string,
  value: Uint8Array,
): Promise<void> {
  await writeFile(output, value, { mode: 0o600 });
}
