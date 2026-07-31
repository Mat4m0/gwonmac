import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  inspectEnhancementCandidate,
  transformEnhancementWasm,
} from "../main/core/enhancement-transform.js";
import { findEnhancementBuild } from "../main/core/enhancement-builds.js";
import { defaultGuildWarsProfile } from "./enhancement-doctor.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
} from "../main/core/template-save-compat.js";

async function main(): Promise<void> {
  const positional = process.argv.slice(2)
    .filter((argument) => argument !== "--")
    .filter((argument) => !argument.startsWith("--"));
  if (positional.length > 1) {
    process.stderr.write("usage: enhancements:recertify [path/to/Gw.jspi.wasm]\n");
    process.exitCode = 2;
    return;
  }
  const filename = positional[0] ?? path.join(
    defaultGuildWarsProfile(),
    "game",
    "artifacts",
    "Gw.jspi.wasm",
  );
  // Main layers the Enhancement transform on the template-save client, so inspect
  // that same input. An official module whose template-save build is unknown is
  // reported as-is, which is exactly what main would then transform.
  const official = await readFile(filename);
  const sha256 = createHash("sha256").update(official).digest("hex");
  const templateSave = findTemplateSaveBuild(sha256);
  const candidate = templateSave
    ? rewriteTemplateSaveWasm(official, templateSave)
    : official;
  const report = inspectEnhancementCandidate(candidate);
  const certified = findEnhancementBuild(report.sha256);
  let bundleVerified = false;
  let bundleFailure: string | null = null;
  if (certified) {
    try {
      transformEnhancementWasm(candidate, certified);
      bundleVerified = true;
    } catch (error) {
      bundleFailure = error instanceof Error ? error.message : "transform failed";
    }
  }
  process.stdout.write(`${JSON.stringify({
    officialSha256: sha256,
    templateSaveApplied: templateSave !== null,
    ...report,
    bundleVerified,
    bundleFailure,
  })}\n`);
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
