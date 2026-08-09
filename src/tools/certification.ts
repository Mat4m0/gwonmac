/**
 * `pnpm certification <subcommand>`: the one command line over the
 * official-client -> template-save -> Enhancement chain.
 *
 * It owns argument parsing, printing and exit codes, and nothing else. Every
 * answer comes from the modules `src/main/certification/` owns, so a report
 * printed here and the decision a launch makes cannot disagree — and the four
 * separate commands this replaced cannot drift apart in how they locate the
 * installed client or spell a failure.
 *
 * `template --write` is the one subcommand that changes a tracked file. It
 * adds a derived entry to the authoring table so a patch-day branch is opened
 * by the same derivation a developer would run by hand, and it refuses every
 * case but a new structurally derived build — including one already certified.
 * It never touches `ENHANCEMENT_BUILDS`: those layout words are client-memory
 * addresses no structural anchor re-derives, so nothing may add them without a
 * person measuring them.
 *
 * Machine-readable output goes to stdout and human findings go to stderr, so a
 * caller can pipe one without losing the other. A misuse exits 2 and a refusal
 * the chain itself made exits 1, uniformly across the four subcommands; only a
 * transform that refuses its input throws, because the hash it names is the
 * finding.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "../main/core/atomic-file.js";
import {
  enhancementOutputSha256,
  findEnhancementBuild,
} from "../main/certification/enhancement-builds.js";
import { transformEnhancementWasm } from "../main/certification/enhancement-transform.js";
import {
  NATIVE_DOUBLE_CLICK_BUILDS,
  rewriteWithBuild,
} from "../main/certification/native-double-click.js";
import {
  findTemplateSaveBuild,
  rewriteTemplateSaveWasm,
} from "../main/certification/template-save-compat.js";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  ENHANCEMENT_TRANSFORM_ABI,
} from "../shared/enhancement-contracts.js";
import {
  currentMessageAnchors,
  recertifyEnhancementBytes,
} from "./enhancement-recert.js";
import {
  defaultGuildWarsProfile,
  inspectEnhancementWorkspace,
} from "./enhancement-workspace.js";
import {
  formatBuildEntry,
  insertBuildEntry,
  inspectTemplateSaveCandidate,
  TEMPLATE_SAVE_TABLE,
} from "./template-save-recert.js";

const USAGE =
  "usage: certification <command>\n"
  + "  doctor [--profile PATH]              why Enhancement is or is not running here\n"
  + "  recertify [PATH/Gw.jspi.wasm]        draft an Enhancement build entry, with evidence\n"
  + "  template [PATH/Gw.jspi.wasm] [--emit-ts] [--write] [--expect-certified]\n"
  + "                                       re-derive the template-save build entry\n"
  + "  transform INPUT.wasm OUTPUT.wasm     write the derived Enhancement module\n"
  + "  double-click [PATH/Gw.jspi.wasm]     re-derive the native double-click table\n";

/**
 * The one fixed profile the command line emits. The other certified profiles
 * are selected through the application path that owns their cache identity,
 * and reproducing that selection here would be a second place where a
 * capability set decides which output is correct.
 */
const FOUNDATION_CAPABILITIES = ENHANCEMENT_CAPABILITY_PROFILES.cursorToolbox;

function installedClientArtifact(): string {
  return path.join(
    defaultGuildWarsProfile(),
    "game",
    "artifacts",
    "Gw.jspi.wasm",
  );
}

function argumentValue(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function positionalArguments(argv: readonly string[]): string[] {
  return argv.filter((argument) => !argument.startsWith("--"));
}

async function doctor(argv: readonly string[]): Promise<void> {
  const profile = argumentValue(argv, "--profile") ?? defaultGuildWarsProfile();
  const report = await inspectEnhancementWorkspace(profile);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.readyForCachedLive) process.exitCode = 1;
}

async function recertify(argv: readonly string[]): Promise<void> {
  const positional = positionalArguments(argv);
  if (positional.length > 1) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const official = await readFile(positional[0] ?? installedClientArtifact());
  const report = recertifyEnhancementBytes(official, currentMessageAnchors());
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.candidateInspected) process.exitCode = 2;
}

async function template(argv: readonly string[]): Promise<void> {
  const emitTypeScript = argv.includes("--emit-ts");
  const writeEntry = argv.includes("--write");
  const expectCertified = argv.includes("--expect-certified");
  const positional = positionalArguments(argv);
  if (positional.length > 1) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const filename = positional[0] ?? installedClientArtifact();
  let input: Uint8Array;
  try {
    input = await readFile(filename);
  } catch {
    process.stderr.write(`certification template: cannot read ${filename}\n`);
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

  // `--write` edits the authoring source, so it refuses everything except the
  // one case it was written for: a structurally derived entry for a build the
  // table does not list. An already-certified build is not a smaller version
  // of that case — it is the answer "nothing to do", and writing anything
  // would produce a branch whose diff nobody asked for.
  if (writeEntry) {
    if (!report.entry || report.certified) {
      process.stderr.write(
        `certification template --write: nothing to add for ${report.sha256}\n`,
      );
      process.exitCode = 1;
      return;
    }
    const table = path.resolve(TEMPLATE_SAVE_TABLE);
    await writeAtomic(
      table,
      insertBuildEntry(await readFile(table, "utf8"), report.entry),
    );
    process.stderr.write(`certification template: added ${report.sha256} to ${TEMPLATE_SAVE_TABLE}\n`);
  }
  if (expectCertified && report.matchesCertifiedEntry !== true) {
    process.stderr.write(
      "certification template: derived entry does not match the certified one\n",
    );
    process.exitCode = 1;
  }
}

async function transform(argv: readonly string[]): Promise<void> {
  const [inputPath, outputPath] = positionalArguments(argv);
  if (!inputPath || !outputPath) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const input = await readFile(inputPath);
  const sha256 = createHash("sha256").update(input).digest("hex");
  const build = findEnhancementBuild(sha256);
  if (!build) throw new Error(`unsupported official WASM hash ${sha256}`);

  const output = transformEnhancementWasm(
    input,
    build,
    FOUNDATION_CAPABILITIES,
  );
  const outputSha256 = createHash("sha256").update(output).digest("hex");
  if (outputSha256 !== enhancementOutputSha256(build, FOUNDATION_CAPABILITIES)) {
    throw new Error(`uncertified foundation output ${outputSha256}`);
  }
  await writeAtomic(path.resolve(outputPath), output);
  process.stdout.write(`${JSON.stringify({
    buildId: build.buildId,
    inputSha256: sha256,
    transformAbi: ENHANCEMENT_TRANSFORM_ABI,
    inputBytes: input.byteLength,
    outputBytes: output.byteLength,
    outputSha256,
    output: path.resolve(outputPath),
  })}\n`);
}

/**
 * Re-derives the native double-click table by running the whole chain from the
 * official bytes: template-save, then each certified Enhancement profile, then
 * this transform against every one of those outputs.
 *
 * It reads nothing from the shipped table except the structural entry — the
 * callback's slot, index, body hash and offsets — so a disagreement between
 * what it prints and what is checked in is a real change in the client rather
 * than a restatement of the constant being checked.
 */
async function doubleClick(argv: readonly string[]): Promise<void> {
  const [filename] = positionalArguments(argv);
  const official = new Uint8Array(
    await readFile(filename ?? installedClientArtifact()),
  );
  const officialSha256 = createHash("sha256").update(official).digest("hex");
  const templateBuild = findTemplateSaveBuild(officialSha256);
  if (!templateBuild) {
    throw new Error(`unsupported official WASM hash ${officialSha256}`);
  }
  const templateSave = rewriteTemplateSaveWasm(official, templateBuild);
  const predecessors: Array<[string, Uint8Array]> = [
    ["template-save", templateSave],
  ];
  const enhancementBuild = findEnhancementBuild(
    createHash("sha256").update(templateSave).digest("hex"),
  );
  if (enhancementBuild) {
    for (const [profile, capabilities] of Object.entries(
      ENHANCEMENT_CAPABILITY_PROFILES,
    )) {
      predecessors.push([
        profile,
        transformEnhancementWasm(templateSave, enhancementBuild, {
          ...capabilities,
        }),
      ]);
    }
  }
  const derivations: Record<string, string> = {};
  for (const [, bytes] of predecessors) {
    const input = createHash("sha256").update(bytes).digest("hex");
    derivations[input] = createHash("sha256")
      .update(rewriteWithBuild(bytes, NATIVE_DOUBLE_CLICK_BUILDS[0]!))
      .digest("hex");
  }
  const shipped = NATIVE_DOUBLE_CLICK_BUILDS[0]!.derivations;
  const matches =
    JSON.stringify(Object.entries(derivations).sort())
    === JSON.stringify(Object.entries(shipped).sort());
  process.stdout.write(`${JSON.stringify({
    officialSha256,
    predecessors: predecessors.map(([name]) => name),
    derivations,
    matchesShippedTable: matches,
  }, null, 2)}\n`);
  if (!matches) {
    process.stderr.write(
      "certification double-click: derived table does not match the shipped one\n",
    );
    process.exitCode = 1;
  }
}

const COMMANDS = Object.freeze({
  doctor,
  recertify,
  template,
  transform,
  "double-click": doubleClick,
});

// The subcommand name is argv, so the lookup has to be closed over own
// properties: a plain object answers for its prototype, which made
// `certification toString` exit 0 having done nothing and `certification
// hasOwnProperty` die with a stack trace instead of printing usage.
function isCommand(value: string): value is keyof typeof COMMANDS {
  return Object.hasOwn(COMMANDS, value);
}

const [name, ...argv] = process.argv.slice(2).filter((value) => value !== "--");
if (name === undefined || !isCommand(name)) {
  process.stderr.write(USAGE);
  process.exitCode = 2;
} else {
  await COMMANDS[name](argv);
}
