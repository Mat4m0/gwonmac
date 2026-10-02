import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * A Hub row never ends the game session directly (HUB-001). "Quit or Reload
 * Game…" promises the account's confirmation sheet, so it opens the one main
 * owner (`showQuitOrReloadGame`) through `app.showQuitOrReload`. Only the clean
 * WASM exit in the harness may call `app.requestQuit`.
 */
describe("the Hub quit policy", () => {
  it("opens the Quit-or-Reload sheet and never calls requestQuit", async () => {
    const hubModules = (await readdir("src/renderer")).filter((file) => /^hub.*\.ts$/u.test(file));
    assert.ok(hubModules.includes("hub.ts"));
    for (const file of hubModules) {
      assert.doesNotMatch(await readFile(`src/renderer/${file}`, "utf8"), /requestQuit/u, file);
    }
    const hub = await readFile("src/renderer/hub.ts", "utf8");
    assert.match(hub, /id: 'reload'[^\n]*app\.showQuitOrReload\(\)/u);
    assert.doesNotMatch(hub, /id: 'call-target'/u, "Call Target stays on its own shortcut (HUB-133)");
    const main = await readFile("src/main/main.ts", "utf8");
    assert.match(main, /showQuitOrReload: \(win\) => showQuitOrReloadGame\(host, win\)/u);
  });
});
