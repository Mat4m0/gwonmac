import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLauncherRendererUrl,
  isCanonicalRendererUrl,
} from "../../src/main/core/renderer-trust.js";
import { senderRefusal, type SenderRole } from "../../src/main/ipc-sender.js";
import { parseProfileId } from "../../src/shared/multiple-accounts.js";
import type { WindowContext } from "../../src/main/window-registry.js";

describe("canonical renderer URL", () => {
  it("allows the launcher document and nothing else", () => {
    for (const url of ["gw://app/", "gw://app/index.html"]) {
      assert.equal(isCanonicalRendererUrl(url), true, url);
    }
  });

  it("rejects every query string, including the ones it used to carry", () => {
    // Launch configuration lives in the preload argument, so the trust
    // root no longer allow-lists anything. A parameter it once accepted is now
    // exactly as untrusted as one it never did.
    for (const url of [
      "gw://app/?enhancement-automation=1",
      "gw://app/?native-cursor=1",
      "gw://app/?template-fs-trace=1",
      "gw://app/?enhancement-automation=1&native-cursor=1",
      "gw://app/index.html?native-cursor=1",
      "gw://app/?unknown=1",
      "gw://app/?enhancement-fixture=map",
    ]) {
      assert.equal(isCanonicalRendererUrl(url), false, url);
    }
  });

  it("rejects proxy, subresource, ambiguous, and malformed URLs", () => {
    for (const url of [
      "gw://app/account/login",
      "gw://app/Gw.jspi.js",
      "gw://app/launcher.html",
      "gw://app/#fragment",
      "gw://user@app/",
      "gw://app:443/",
      "https://app/",
      "not a URL",
    ]) {
      assert.equal(isCanonicalRendererUrl(url), false, url);
    }
  });

  it("gives the launcher its own document boundary", () => {
    assert.equal(isLauncherRendererUrl("gw://app/launcher/index.html"), true);
    for (const url of [
      "gw://app/",
      "gw://app/index.html",
      "gw://app/launcher/index.html?profile=one",
      "gw://app/launcher/index.html#profile",
      "gw://app/launcher/assets/app.js",
    ]) {
      assert.equal(isLauncherRendererUrl(url), false, url);
    }
  });
});

describe("IPC sender refusal", () => {
  const game: WindowContext = { role: "game", profileId: parseProfileId("9e1bd41c-cfc0-4ca8-a57f-2f0ca159c72d") };
  const launcher: WindowContext = { role: "launcher" };
  const settings: WindowContext = { role: "settings" };
  const GAME = "gw://app/index.html";
  const LAUNCHER = "gw://app/launcher/index.html";
  const SETTINGS = "gw://app/launcher/settings.html";
  const cases: [string, SenderRole, WindowContext | null, boolean, string, string | null][] = [
    ["Settings writes from the Settings window", "settings", settings, true, SETTINGS, null],
    ["shared state from the launcher", ["launcher", "settings"], launcher, true, LAUNCHER, null],
    ["shared state from Settings", ["launcher", "settings"], settings, true, SETTINGS, null],
    ["Settings writes from the launcher", "settings", launcher, true, LAUNCHER, "unowned ipc sender"],
    ["Settings writes from a game window", "settings", game, true, GAME, "unowned ipc sender"],
    ["account actions from Settings", "launcher", settings, true, SETTINGS, "unowned ipc sender"],
    ["shared state from a game window", ["launcher", "settings"], game, true, GAME, "unowned ipc sender"],
    ["an unregistered window", "any", null, true, SETTINGS, "unowned ipc sender"],
    ["a subframe of the Settings window", "settings", settings, false, SETTINGS, "ipc sender is not the main frame"],
    ["a Settings window showing the launcher page", "settings", settings, true, LAUNCHER, "invalid ipc origin"],
    ["a Settings window with a query", "settings", settings, true, `${SETTINGS}?section=game`, "invalid ipc origin"],
    ["a launcher window showing the Settings page", "launcher", launcher, true, SETTINGS, "invalid ipc origin"],
  ];
  for (const [name, role, context, mainFrame, url, expected] of cases) {
    it(`${expected ? "refuses" : "accepts"} ${name}`, () => {
      assert.equal(senderRefusal(role, context, mainFrame, url), expected);
    });
  }
});
