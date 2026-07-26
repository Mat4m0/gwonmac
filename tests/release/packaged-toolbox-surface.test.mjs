import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import forgeConfig, { assertBuildIsFresh } from "../../forge.config.ts";

// What the packaged app is allowed to contain, asserted against the artifact
// rather than against the sources that produce it. The Toolbox is not
// developer-only any more — `nativeCursor` ships on, so the kernel, the
// renderer runtime and the build tables have to be inside the app. What must
// never be inside it is the developer surface: recertifiers, the doctor, the
// observation CLI, the live scenario runner and the benchmark driver. And
// automation — the one tier that can send game input — has to stay
// unreachable from a packaged build whatever the environment says.

const root = path.resolve(import.meta.dirname, "../..");

// Everything below asserts against build/, so a stale build/ would certify
// yesterday's output as today's artifact. `pnpm test` builds first; run
// standalone it might not have.
assertBuildIsFresh(root);

// @electron/packager applies `packagerConfig.ignore` as an fs-extra copy
// filter — `filter = (file) => !ignore(name)`, where `name` is the path
// relative to the project root with a leading "/" — and fs-extra never
// descends into a directory the filter rejected (node_modules/@electron/
// packager/dist/copy-filter.js). This walk is that copy: what it collects is
// what lands in `Guild Wars.app/Contents/Resources/app.asar`.
const ignore = forgeConfig.packagerConfig?.ignore;
assert.equal(typeof ignore, "function", "forge.config.ts still decides what ships");

function packagedFiles(directory = root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`;
    if (ignore(name)) continue;
    if (entry.isDirectory()) {
      files.push(...packagedFiles(path.join(directory, entry.name), name));
    } else {
      files.push(name);
    }
  }
  return files;
}

const packaged = new Set(packagedFiles());
const shippedText = (file) => readFileSync(path.join(root, file.slice(1)), "utf8");

test("the packaged app contains the Toolbox runtime and its build tables", () => {
  for (const file of [
    // The kernel and the renderer half of the Toolbox.
    "/build/renderer/toolbox-kernel.wasm",
    "/build/renderer/toolbox.js",
    "/build/renderer/toolbox-snapshot.js",
    "/build/renderer/toolbox-cursor.js",
    // The main-process half: the transform, its client, the build tables that
    // say which ArenaNet build a transform is certified against, and the gate.
    "/build/main/core/toolbox-transform.js",
    "/build/main/core/toolbox-client.js",
    "/build/main/core/toolbox-builds.js",
    "/build/main/toolbox-policy.js",
    // The rest of the launch path, so a build that produced almost nothing
    // cannot make the absence assertions below pass by shipping nothing.
    "/build/main/main.js",
    "/build/preload/preload.cjs",
    "/build/renderer/index.html",
    "/build/renderer/images/index.json",
    "/package.json",
  ]) {
    assert.ok(packaged.has(file), `${file} is missing from the packaged app`);
  }
});

test("the packaged app contains no developer tool", () => {
  // Named artifacts. Each has to exist in the built tree first: an assertion
  // that a file does not ship is worthless if the file was never produced.
  for (const file of [
    "/build/tools/template-save-recert.js",
    "/build/tools/template-save-recertify.js",
    "/build/tools/toolbox-recertify.js",
    "/build/tools/toolbox-doctor.js",
    "/build/tools/toolbox-observations.js",
    "/build/tools/toolbox-transform.js",
    "/scripts/toolbox-live.mjs",
    "/scripts/toolbox-live/scenarios.mjs",
    "/scripts/toolbox-live/performance.mjs",
    "/scripts/toolbox-visual.mjs",
  ]) {
    assert.ok(
      existsSync(path.join(root, file.slice(1))),
      `${file} does not exist, so its absence from the app proves nothing`,
    );
    assert.ok(!packaged.has(file), `${file} ships in the packaged app`);
  }

  // Nothing else developer-shaped either, wherever it is placed. The
  // recertifier shipped as /build/main/core/template-save-recert.js until it
  // moved out of core; the name, not the directory, is what disqualified it.
  const developerShaped = /recert|doctor|observation|scenario|benchmark|\.map$|\.d\.ts$/u;
  assert.deepEqual(
    [...packaged].filter((file) => developerShaped.test(file)),
    [],
  );

  // And the package is confined to the four runtime trees plus the manifest,
  // so a new top-level directory cannot arrive inside the app unnoticed.
  for (const file of packaged) {
    assert.match(
      file,
      /^\/(?:build\/(?:main|shared|renderer|preload)\/|package\.json$)/u,
    );
  }
});

test("the packaged launcher page ships no static Toolbox markup", () => {
  // Named for what it proves and nothing wider. The Toolbox's one UI surface —
  // the target readout — is created in JS with an inline style, so it is
  // *deliberately* out of this test's reach: no assertion over the shipped
  // index.html or harness.css can see it, and one named "exposes no Toolbox UI"
  // would be claiming a property it cannot check. What this does prove is that
  // the launcher page itself carries no Toolbox element or script tag, so the
  // only way into the Toolbox graph stays the gated dynamic import in
  // `harness.js`. The runtime surface belongs to an Electron session.
  //
  // Read out of the packaged set, not out of src/: this is the page a player's
  // renderer actually parses.
  assert.doesNotMatch(
    shippedText("/build/renderer/index.html"),
    /id="toolbox"|src="toolbox\.js"/u,
  );
  assert.doesNotMatch(
    shippedText("/build/renderer/harness.css"),
    /#toolbox|\.toolbox-/u,
  );
});

// The gate itself, executed rather than read. `TOOLBOX_AUTOMATION_ENABLED` is
// resolved once at module load from `app.isPackaged`, so each case is a fresh
// process with a stubbed `electron`: the module cannot be re-evaluated in one
// process, and Electron's own `app` does not exist under `node --test`.
const probeDirectory = mkdtempSync(path.join(tmpdir(), "gw-toolbox-gate-"));
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
    automation: policy.TOOLBOX_AUTOMATION_ENABLED,
    cursorOff: policy.toolboxEnabledFor({ nativeCursor: false }),
    cursorOn: policy.toolboxEnabledFor({ nativeCursor: true }),
  }),
);
`,
);

/** Loads the packaged policy module in a build that is, or is not, packaged. */
function toolboxGate({ isPackaged, automationVariable }) {
  const environment = { ...process.env };
  delete environment.GW_TOOLBOX_AUTOMATION;
  if (automationVariable !== undefined) {
    environment.GW_TOOLBOX_AUTOMATION = automationVariable;
  }
  environment.GW_PROBE_PACKAGED = isPackaged ? "1" : "0";
  environment.GW_PROBE_POLICY = pathToFileURL(
    path.join(root, "build/main/toolbox-policy.js"),
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
    const gate = toolboxGate({ isPackaged: true, automationVariable });
    assert.equal(gate.automation, false, `GW_TOOLBOX_AUTOMATION=${automationVariable}`);
    // Such a build still gets the Toolbox from the player's own cursor
    // setting, and only from there — never from the environment.
    assert.equal(gate.cursorOff, false);
    assert.equal(gate.cursorOn, true);
  }

  // Unpackaged, the variable is the switch, and only the exact value "1".
  const enabled = toolboxGate({ isPackaged: false, automationVariable: "1" });
  assert.equal(enabled.automation, true);
  assert.equal(enabled.cursorOff, true);
  for (const automationVariable of ["true", "0", "", undefined]) {
    const gate = toolboxGate({ isPackaged: false, automationVariable });
    assert.equal(gate.automation, false, `GW_TOOLBOX_AUTOMATION=${automationVariable}`);
    assert.equal(gate.cursorOff, false);
  }
});

test("the cursor ships on, and a player who switches it off stays off", async () => {
  const { DEFAULT_SETTINGS } = await import(
    new URL("../../build/shared/contracts.js", import.meta.url)
  );
  const { parseSettings } = await import(
    new URL("../../build/main/core/settings.js", import.meta.url)
  );

  assert.equal(DEFAULT_SETTINGS.nativeCursor, true);
  // A profile from before the flip never wrote the key; it gets the default.
  assert.equal(parseSettings({ renderScale: 1 }).nativeCursor, true);
  // A player who turned it off keeps it off across the same read path. The
  // default must never be re-applied over a recorded "no".
  assert.equal(parseSettings({ nativeCursor: false }).nativeCursor, false);

  // Off is reachable from the shipped UI, not only from the file.
  assert.match(shippedText("/build/renderer/index.html"), /name="nativeCursor"/u);
});
