import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, test } from "@playwright/test";
import { launchDevelopmentApp, verifyDevelopmentApp } from "../../scripts/run-dev.js";
import { root } from "./fixtures.mjs";

test("development launch proves the real visible launcher and refuses a second profile owner", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "gwonmac-dev-proof-"));
  try {
    const { app, receipt } = await launchDevelopmentApp(profile, true);
    try {
      assert.equal(receipt.root, root);
      assert.equal(receipt.profile, await realpath(profile));
      assert.equal(receipt.pid, app.process().pid);
      assert.equal(receipt.url, "gw://app/launcher/index.html");
      assert.equal(receipt.status, "launcher-open");
      await assert.rejects(launchDevelopmentApp(profile, true), /Profile already running/);
      assert.equal(app.process().exitCode, null, "refusal preserves the original app");
    } finally { await app.close(); }
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test("bare Electron cannot be reported as the project launcher", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "gwonmac-bare-electron-"));
  try {
    const app = await electron.launch({ args: [`--user-data-dir=${profile}`] });
    try {
      await assert.rejects(verifyDevelopmentApp(app, root, profile), /identity mismatch/);
    } finally { await app.close(); }
  } finally { await rm(profile, { recursive: true, force: true }); }
});
