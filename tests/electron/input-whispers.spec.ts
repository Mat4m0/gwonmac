import { expect, test } from "@playwright/test";
import { closeOffline, launchPlayableClient } from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test("embedded whispers open on the first click and retain draft input when raised", async () => {
  const fixture = await launchPlayableClient("gw-whispers-input-e2e-");
  try {
    const { page } = fixture;
    await startGameInput(page);
    await page.evaluate(async () => {
      document.getElementById("loading")?.classList.add("gone");
      const modelPath = "./shared/whisper-session.js";
      const surfacePath = "./whisper-surface.js";
      const model = await import(modelPath) as typeof import("../../src/shared/whisper-session.js");
      const surface = await import(surfacePath) as typeof import("../../src/renderer/whisper-surface.js");
      const session = model.createWhisperSession(async () => {});
      session.setAvailable(true);
      session.observe([{ id: 1, sender: "Test Friend", message: "Hello", direction: "incoming" }]);
      surface.createWhisperSurface(document.body, session);
      // Force a real stacking change on the first click.
      document.body.append(document.createElement("aside"));
    });
    const launcher = page.getByRole("button", { name: /Whispers, 1 unread/ });
    await launcher.click();
    const panel = page.locator("#whisper-window");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /Test Friend Hello/ }).click();
    const field = panel.getByRole("textbox", { name: "Message Test Friend" });
    await field.fill("Keep my draft");
    await page.evaluate(() => document.body.append(document.createElement("aside")));
    await field.click();
    await expect(field).toBeFocused();
    await field.press("End");
    await field.pressSequentially(" here");
    await expect(field).toHaveValue("Keep my draft here");
    await panel.getByRole("button", { name: "Collapse whispers" }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: /Whispers, 0 unread/ }).click();
    await expect(panel).toBeVisible();
    await expect(field).toHaveValue("Keep my draft here");
  } finally { await closeOffline(fixture); }
});
