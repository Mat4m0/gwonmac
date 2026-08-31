/**
 * Validates one Cartography evidence JSON document or diagnostics ZIP and
 * reports a closed pass or failure for QA automation.
 */
import { resolve } from "node:path";
import { readCartographyEvidence } from "./io.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: pnpm cartography:validate <evidence.zip|cartography-report.json>");
  process.exitCode = 2;
} else {
  try {
    const report = await readCartographyEvidence(resolve(input));
    console.log(`valid Cartography evidence ${report.contentSha256}`);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : "invalid evidence"}`);
    process.exitCode = 1;
  }
}
