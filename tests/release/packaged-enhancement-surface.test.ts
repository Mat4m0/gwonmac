import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import forgeConfig from "../../forge.config.ts";
import {
  assertNoDeveloperPackageFiles,
  assertRequiredPackageFiles,
  DEVELOPER_PACKAGE_FILES,
  forgePackageFiles,
  htmlScriptEntryPoints,
  PRELOAD_ENTRY,
  relativeEsmClosure,
} from "../helpers/package-inventory.ts";

// What the packaged app is allowed to contain, asserted against the artifact
// rather than against the sources that produce it. The Enhancement is not
// developer-only any more — `nativeCursor` ships on, so the kernel, the
// renderer runtime and the build tables have to be inside the app. What must
// never be inside it is the developer surface: recertifiers, the doctor, the
// observation CLI, the live scenario runner and the benchmark driver. And
// automation — the one tier that can send game input — has to stay
// unreachable from a packaged build whatever the environment says.

const root = path.resolve(import.meta.dirname, "../..");

// @electron/packager applies `packagerConfig.ignore` as an fs-extra copy
// filter — `filter = (file) => !ignore(name)`, where `name` is the path
// relative to the project root with a leading "/" — and fs-extra never
// descends into a directory the filter rejected (node_modules/@electron/
// packager/dist/copy-filter.js). This walk is that copy: what it collects is
// what lands in the target platform's packaged `resources/app.asar`.
const ignore = forgeConfig.packagerConfig?.ignore;
assert.equal(typeof ignore, "function", "forge.config.ts still decides what ships");

const packaged = new Set(forgePackageFiles(root, ignore));
const shippedText = (file: string) => readFileSync(path.join(root, file.slice(1)), "utf8");

test("the packaged app contains the Enhancement runtime and its build tables", () => {
  assertRequiredPackageFiles(packaged);
});

test("every relative ESM dependency reachable from a shipped entry point is packaged", () => {
  const manifest = JSON.parse(shippedText("/package.json"));
  const rendererIndex = "/build/renderer/index.html";
  const closure = relativeEsmClosure({
    entryPoints: [
      manifest.main,
      PRELOAD_ENTRY,
      ...htmlScriptEntryPoints(rendererIndex, shippedText(rendererIndex)),
    ],
    inventory: packaged,
    readText: shippedText,
  });

  // These are deliberately transitive rather than entry-point imports. They
  // prove the walk reached both the main and renderer dependency graphs.
  assert.ok(closure.has("/build/main/core/enhancement-builds.js"));
  assert.ok(closure.has("/build/renderer/enhancement-readout.js"));
});

test("the packaged app contains no developer tool", () => {
  // Named artifacts. Each has to exist in the built tree first: an assertion
  // that a file does not ship is worthless if the file was never produced.
  for (const file of DEVELOPER_PACKAGE_FILES) {
    assert.ok(
      existsSync(path.join(root, file.slice(1))),
      `${file} does not exist, so its absence from the app proves nothing`,
    );
  }
  // Also catches a renamed/moved developer artifact and any new top-level
  // package tree, rather than protecting only the names above.
  assertNoDeveloperPackageFiles(packaged);
});

test("the packaged launcher page ships no static Enhancement markup", () => {
  // Named for what it proves and nothing wider. The Enhancement's one UI surface —
  // the target readout — is created in JS with an inline style, so it is
  // *deliberately* out of this test's reach: no assertion over the shipped
  // index.html or harness.css can see it, and one named "exposes no Enhancement UI"
  // would be claiming a property it cannot check. What this does prove is that
  // the launcher page itself carries no Enhancement element or script tag, so the
  // only way into the Enhancement graph stays the gated dynamic import in
  // `harness.js`. The runtime surface belongs to an Electron session.
  //
  // Read out of the packaged set, not out of src/: this is the page a player's
  // renderer actually parses.
  assert.doesNotMatch(
    shippedText("/build/renderer/index.html"),
    /id="enhancement"|src="enhancement\.js"/u,
  );
  assert.doesNotMatch(
    shippedText("/build/renderer/harness.css"),
    /#enhancement|\.enhancement-/u,
  );
});

// The gate itself, executed rather than read. `ENHANCEMENT_AUTOMATION_ENABLED` is
// resolved once at module load from `app.isPackaged`, so each case is a fresh
// process with a stubbed `electron`: the module cannot be re-evaluated in one
// process, and Electron's own `app` does not exist under `node --test`.
const probeDirectory = mkdtempSync(path.join(tmpdir(), "gw-enhancement-gate-"));
after(() => rmSync(probeDirectory, { recursive: true, force: true }));

writeFileSync(
  path.join(probeDirectory, "electron.mjs"),
  'export const app = { isPackaged: process.env.GW_PROBE_PACKAGED === "1" };\n',
);
writeFileSync(
  path.join(probeDirectory, "resolve.mjs"),
  `export function resolve(specifier, context, next) {
  if (specifier === "electron") {
    return {
      url: new URL("./electron.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
`,
);
writeFileSync(
  path.join(probeDirectory, "probe.mjs"),
  `import { register } from "node:module";
register(new URL("./resolve.mjs", import.meta.url));
const policy = await import(process.env.GW_PROBE_POLICY);
console.log(
  JSON.stringify({
    automation: policy.ENHANCEMENT_AUTOMATION_ENABLED,
    none: policy.enhancementsEnabledFor({
      nativeCursor: false,
      targetReadout: false,
    }),
    cursorOnly: policy.enhancementsEnabledFor({
      nativeCursor: true,
      targetReadout: false,
    }),
    readoutOnly: policy.enhancementsEnabledFor({
      nativeCursor: false,
      targetReadout: true,
    }),
  }),
);
`,
);

/** What probe.mjs above prints: the gate's answer for one launch posture. */
interface EnhancementGate {
  automation: boolean;
  none: boolean;
  cursorOnly: boolean;
  readoutOnly: boolean;
}

/** Loads the packaged policy module in a build that is, or is not, packaged. */
function enhancementGate({
  isPackaged,
  automationVariable,
}: {
  isPackaged: boolean;
  automationVariable: string | undefined;
}): EnhancementGate {
  const environment = { ...process.env };
  delete environment.GW_ENHANCEMENT_AUTOMATION;
  if (automationVariable !== undefined) {
    environment.GW_ENHANCEMENT_AUTOMATION = automationVariable;
  }
  environment.GW_PROBE_PACKAGED = isPackaged ? "1" : "0";
  environment.GW_PROBE_POLICY = pathToFileURL(
    path.join(root, "build/main/enhancement-policy.js"),
  ).href;

  return JSON.parse(
    execFileSync(process.execPath, [path.join(probeDirectory, "probe.mjs")], {
      encoding: "utf8",
      env: environment,
    }),
  );
}

test("automation is the one tier a packaged build cannot reach", () => {
  // The public claim: a packaged build sends no game input, whatever the
  // environment says.
  for (const automationVariable of ["1", "true", undefined]) {
    const gate = enhancementGate({ isPackaged: true, automationVariable });
    assert.equal(gate.automation, false, `GW_ENHANCEMENT_AUTOMATION=${automationVariable}`);
    // Such a build gets the Enhancement from either independently selected tool,
    // and only from those tools — never from the environment.
    assert.equal(gate.none, false);
    assert.equal(gate.cursorOnly, true);
    assert.equal(gate.readoutOnly, true);
  }

  // Unpackaged, the variable is the switch, and only the exact value "1".
  const enabled = enhancementGate({ isPackaged: false, automationVariable: "1" });
  assert.equal(enabled.automation, true);
  assert.equal(enabled.none, true);
  for (const automationVariable of ["true", "0", "", undefined]) {
    const gate = enhancementGate({ isPackaged: false, automationVariable });
    assert.equal(gate.automation, false, `GW_ENHANCEMENT_AUTOMATION=${automationVariable}`);
    assert.equal(gate.none, false);
  }
});

test("the tools keep independent defaults and explicit choices", async () => {
  // Loaded from `build/`, which is this suite's subject, and typed from the
  // `src/` modules `build/` is emitted from. The annotation is on the
  // declaration rather than an assertion on the call: a dynamic `import()`
  // whose specifier is not a literal resolves to `any`, so without it a renamed
  // export would read as `undefined` here instead of failing `tsc`.
  const { DEFAULT_SETTINGS }: typeof import("../../src/shared/contracts.ts") =
    await import(new URL("../../build/shared/contracts.js", import.meta.url).href);
  const { parseSettings }: typeof import("../../src/main/core/settings.ts") =
    await import(new URL("../../build/main/core/settings.js", import.meta.url).href);

  assert.equal(DEFAULT_SETTINGS.nativeCursor, true);
  assert.equal(DEFAULT_SETTINGS.targetReadout, false);
  // A profile from before the flip never wrote the key; it gets the default.
  assert.equal(parseSettings({ renderScale: 1 }).nativeCursor, true);
  assert.equal(parseSettings({ renderScale: 1 }).targetReadout, false);
  // A player who turned it off keeps it off across the same read path. The
  // default must never be re-applied over a recorded "no".
  assert.equal(parseSettings({ nativeCursor: false }).nativeCursor, false);
  assert.equal(parseSettings({ targetReadout: true }).targetReadout, true);

  // Every choice is reachable from the shipped UI, not only from the file.
  assert.match(shippedText("/build/renderer/index.html"), /name="nativeCursor"/u);
  assert.match(shippedText("/build/renderer/index.html"), /name="targetReadout"/u);
});
