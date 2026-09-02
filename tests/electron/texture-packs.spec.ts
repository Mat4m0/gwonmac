/** End-to-end proof for launcher selection and immutable game-window generations. */
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { gamePaths } from "../../src/main/core/paths.js";
import { TexturePackManager } from "../../src/main/core/texture-pack-manager.js";
import { tinyTpf } from "../helpers/tpf-fixture.js";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";

test("selects one managed TPF for a new game window and keeps its generation immutable", async () => {
  let importedPackId = "";
  const fixture = await launchCachedClient("gw-texture-pack-e2e-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  }, async (userData) => {
    const paths = gamePaths(userData);
    const source = path.join(userData, "Minimalus UI.tpf");
    await writeFile(source, tinyTpf());
    const manager = new TexturePackManager({
      root: paths.texturePacks,
      selection: paths.texturePackSelection,
      packs: paths.texturePackSources,
      staging: paths.texturePackStaging,
    }, () => undefined);
    await manager.initialise();
    const imported = await manager.importFile(source);
    expect(imported.status).toBe("imported");
    if (imported.status === "imported") importedPackId = imported.packId;
  });
  try {
    if (await fixture.page.getByRole("button", { name: "Continue" }).isVisible()) {
      await fixture.page.getByRole("button", { name: "Continue" }).click();
      await fixture.page.getByRole("button", { name: "Not now" }).click();
      await fixture.page.getByRole("button", { name: "Skip" }).click();
    }
    await fixture.page.getByRole("button", { name: "Settings" }).click();
    await fixture.page.getByRole("button", { name: "Texture packs" }).click();
    await expect(fixture.page.getByText("Minimalus UI", { exact: true })).toBeVisible();
    await fixture.page.getByRole("radio", { name: /Minimalus UI/u }).check();
    await expect.poll(() => fixture.page.evaluate(() =>
      window.launcherNative.state.get().then((state) => state.texturePacks.selectedPackId),
    )).toBe(importedPackId);

    const profileId = await fixture.page.evaluate(async () =>
      (await window.launcherNative.state.get()).profiles.find((profile) => !profile.archived)?.id,
    );
    expect(profileId).toBeTruthy();
    const opened = fixture.app.waitForEvent("window", { timeout: 30_000 });
    await fixture.page.evaluate((id) => window.launcherNative.profiles.play([id!]), profileId);
    const game = await opened;
    await game.waitForLoadState("domcontentloaded");
    await expect.poll(() => game.evaluate(() => window.gwNative.init.texturePackGeneration))
      .toBe(importedPackId);

    await fixture.page.evaluate(() => window.launcherNative.texturePacks.select(null));
    expect(await game.evaluate(() => window.gwNative.init.texturePackGeneration)).toBe(importedPackId);
  } finally {
    await closeOffline(fixture);
  }
});
