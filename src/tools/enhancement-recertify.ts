import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { inspectEnhancementCandidate } from "../main/core/enhancement-transform.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
} from "../main/core/template-save-compat.js";

async function main(): Promise<void> {
  const filename = process.argv[2];
  if (!filename) {
    process.stderr.write("usage: enhancements:recertify path/to/Gw.jspi.wasm\n");
    process.exitCode = 2;
    return;
  }
  // Main layers the Enhancement transform on the template-save client, so inspect
  // that same input. An official module whose template-save build is unknown is
  // reported as-is, which is exactly what main would then transform.
  const official = await readFile(filename);
  const sha256 = createHash("sha256").update(official).digest("hex");
  const templateSave = findTemplateSaveBuild(sha256);
  const candidate = templateSave
    ? rewriteTemplateSaveWasm(official, templateSave)
    : official;
  process.stdout.write(`${JSON.stringify({
    officialSha256: sha256,
    templateSaveApplied: templateSave !== null,
    ...inspectEnhancementCandidate(candidate),
  })}\n`);
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
