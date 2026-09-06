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
      session.observe(Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        sender: "Test Friend",
        message: `Message ${index + 1}`,
        direction: "incoming" as const,
      })));
      surface.createWhisperSurface(document.body, session);
      // Force a real stacking change on the first click.
      document.body.append(document.createElement("aside"));
    });
    const launcher = page.getByRole("button", { name: /Whispers, 30 unread/ });
    await launcher.click();
    const panel = page.locator("#whisper-window");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /Test Friend Message 30/ }).click();
    const transcript = panel.locator("[data-transcript]");
    await panel.getByRole("button", { name: "30 new · Show latest" }).click();
    await transcript.evaluate(element => { element.scrollTop = 30; element.dispatchEvent(new Event("scroll")); });
    const field = panel.getByRole("textbox", { name: "Message Test Friend" });
    await field.fill("Keep my draft");
    await page.evaluate(() => document.body.append(document.createElement("aside")));
    await field.click();
    await expect(field).toBeFocused();
    await field.press("End");
    await field.pressSequentially(" here");
    await expect(field).toHaveValue("Keep my draft here");
    await panel.locator('[aria-label="Chat options"]').click();
    const opacity = panel.getByRole("slider", { name: "Background" });
    const head = panel.locator(".whisper-head");
    const bubble = panel.locator(".whisper-bubble").first();
    const composer = panel.locator(".whisper-input-row");
    const fullTranscriptBackground = await transcript.evaluate(element => getComputedStyle(element).backgroundColor);
    const fullHeadBackground = await head.evaluate(element => getComputedStyle(element).backgroundColor);
    const fullFrameEdge = await panel.evaluate(element => getComputedStyle(element, "::before").backgroundColor);
    const fullHeadEdge = await head.evaluate(element => getComputedStyle(element).borderBottomColor);
    const fullBubbleBackground = await bubble.evaluate(element => getComputedStyle(element).backgroundColor);
    const fullBubbleEdge = await bubble.evaluate(element => getComputedStyle(element).boxShadow);
    const fullComposerBackground = await composer.evaluate(element => getComputedStyle(element).backgroundColor);
    const fullComposerEdge = await composer.evaluate(element => getComputedStyle(element).borderColor);
    const bounds = await opacity.boundingBox();
    if (!bounds) throw new Error("Background slider is not visible");
    await opacity.click({ position: { x: bounds.width * 0.2, y: bounds.height / 2 } });
    await expect(opacity).toHaveValue("30");
    await expect.poll(() => transcript.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(fullTranscriptBackground);
    await expect.poll(() => head.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(fullHeadBackground);
    await expect.poll(() => panel.evaluate(element => getComputedStyle(element, "::before").backgroundColor))
      .not.toBe(fullFrameEdge);
    await expect.poll(() => head.evaluate(element => getComputedStyle(element).borderBottomColor))
      .not.toBe(fullHeadEdge);
    await expect.poll(() => bubble.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(fullBubbleBackground);
    await expect.poll(() => bubble.evaluate(element => getComputedStyle(element).boxShadow))
      .not.toBe(fullBubbleEdge);
    await expect.poll(() => composer.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(fullComposerBackground);
    await expect.poll(() => composer.evaluate(element => getComputedStyle(element).borderColor))
      .not.toBe(fullComposerEdge);
    await panel.getByRole("button", { name: "Collapse whispers" }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: /Whispers, 0 unread/ }).click();
    await expect(panel).toBeVisible();
    expect(await transcript.evaluate(element => element.scrollTop)).toBe(30);
    await expect(field).toHaveValue("Keep my draft here");
  } finally { await closeOffline(fixture); }
});
