import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatBuildEntry,
  inspectTemplateSaveCandidate,
} from "./template-save-recert.js";
import { defaultGuildWarsProfile } from "./toolbox-doctor.js";

const USAGE =
  "usage: template:recertify [path/to/Gw.jspi.wasm]"
  + " [--emit-ts] [--expect-certified]\n";

function defaultArtifact(): string {
  return path.join(
    defaultGuildWarsProfile(),
    "game",
    "artifacts",
    "Gw.jspi.wasm",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((argument) => argument !== "--");
  const emitTypeScript = argv.includes("--emit-ts");
  const expectCertified = argv.includes("--expect-certified");
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  if (positional.length > 1) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const filename = positional[0] ?? defaultArtifact();
  let input: Uint8Array;
  try {
    input = await readFile(filename);
  } catch {
    process.stderr.write(`template:recertify: cannot read ${filename}\n`);
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const report = inspectTemplateSaveCandidate(input);
  process.stdout.write(`${JSON.stringify(report)}\n`);

  // Paste-ready entry goes to stderr so stdout stays machine-parseable. The
  // 23-byte delete-file body is the one value nobody should retype by hand: a
  // wrong byte fails as "not the expected stub", which reads exactly like the
  // build having genuinely changed.
  if (emitTypeScript && report.entry) {
    process.stderr.write(`\n${formatBuildEntry(report.entry)}\n`);
  }

  if (report.status === "failed") {
    process.exitCode = 1;
    return;
  }
  if (expectCertified && report.matchesCertifiedEntry !== true) {
    process.stderr.write(
      "template:recertify: derived entry does not match the certified one\n",
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
