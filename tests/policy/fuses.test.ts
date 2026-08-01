// Packaging policy: the nine Electron fuses AGENTS.md names as load-bearing are
// set explicitly in forge.config.ts, and `strictlyRequireAllFuses` makes a
// missing one a packaging failure rather than a silent default.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");

const FUSES = {
  RunAsNode: false,
  EnableCookieEncryption: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
  WasmTrapHandlers: true,
};

test("release fuses keep Node, inspection and file-protocol privileges disabled", () => {
  for (const [name, value] of Object.entries(FUSES)) {
    assert.match(
      forge,
      new RegExp(`\\[FuseV1Options\\.${name}\\]: ${value}`),
      `FuseV1Options.${name} must be ${value}`,
    );
  }
  assert.match(forge, /strictlyRequireAllFuses: true/);
});

test("no fuse is left to its default", () => {
  const configured = [...forge.matchAll(/\[FuseV1Options\.(\w+)\]/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(configured.sort(), Object.keys(FUSES).sort());
});
