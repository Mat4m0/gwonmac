/**
 * Exercises the adaptive Character Switch palette against the real renderer
 * surface and focus controller without invoking any native game action.
 */
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeOffline,
  isDomActiveElement,
  launchCachedClient,
} from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test("a 27-character account searches, scrolls, and keeps the ten-key default", async () => {
  const fixture = await launchCachedClient("gw-character-switch-e2e-");
  try {
    const { page } = fixture;
    await startGameInput(page);
    await page.evaluate(() => {
      document.getElementById("loading")?.classList.add("gone");
      const characters = Array.from({ length: 27 }, (_, index) => ({
        name: index === 26 ? "Rudolph Prime" : `Character ${String(index + 1).padStart(2, "0")}`,
        characterKey: (index + 1).toString(16).padStart(16, "0"),
        primaryProfession: index % 10 + 1,
        secondaryProfession: index % 3 === 0 ? 0 : (index + 4) % 10 + 1,
        characterType: "roleplaying" as const,
        campaign: 1,
        level: 20,
        mapId: index % 2 === 0 ? 55 : 999,
      }));
      let switching = false;
      const listeners = new Set<() => void>();
      window.gwCharacterSwitchHost?.attach({
        characters: {
          status: "ready",
          sequence: 8,
          selectedIndex: 0,
          characters,
        },
        get action() {
          return switching
            ? ({ status: "switching", stage: "logout" } as const)
            : ({ status: "idle" } as const);
        },
        usage: { formatVersion: 1, sequence: 0, entries: [] },
        context: "outpost",
        request(characterKey) {
          const index = characters.findIndex((character) => character.characterKey === characterKey);
          document.body.dataset.characterSwitchRequest = String(index);
          switching = true;
          for (const listener of listeners) listener();
        },
        confirm() {},
        cancelConfirmation() {},
        reset() {},
        diagnostics: () => ({ version: 1, stage: "unavailable", lastCode: "play-path-unproved" }),
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
      });
      window.dispatchEvent(new CustomEvent("gw:character-toggle", { cancelable: true }));
    });

    const dialog = page.getByRole("dialog", { name: "Switch Character" });
    const search = page.getByRole("combobox", { name: "Search characters" });
    const list = dialog.getByRole("listbox", { name: "Characters" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await expect(list.getByRole("option")).toHaveCount(10);
    await expect(list.locator("img")).toHaveCount(10);
    await expect(list.locator(".character-switch-meta").first()).toContainText("Level 20");
    await expect(list.locator(".character-switch-meta").first()).toContainText("Lion's Arch");

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    const professionSetting = dialog.getByRole("checkbox", { name: /Show profession/u });
    const levelSetting = dialog.getByRole("checkbox", { name: /Show level/u });
    const locationSetting = dialog.getByRole("checkbox", { name: /Show known location/u });
    await expect(professionSetting).toBeChecked();
    await expect(levelSetting).toBeChecked();
    await expect(locationSetting).toBeChecked();

    await professionSetting.uncheck();
    await expect(professionSetting).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(list.locator("img")).toHaveCount(0);
    await expect(list.locator(".character-switch-meta").first()).toHaveText(
      "Level 20 · Lion's Arch",
    );

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    await levelSetting.uncheck();
    await expect(levelSetting).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(list.locator(".character-switch-meta").first()).toHaveText("Lion's Arch");

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    await locationSetting.uncheck();
    await expect(locationSetting).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(list.locator(".character-switch-meta")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect(list.locator("img")).toHaveCount(0);
    await expect(list.locator(".character-switch-meta")).toHaveCount(0);

    await search.fill("Character");
    await expect(list.getByRole("option")).toHaveCount(26);
    await expect.poll(() => list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await search.press("1");
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await search.fill("rud");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option")).toContainText("Rudolph Prime");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(list.getByRole("option")).toHaveCount(10);

    await search.press("Tab");
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.getAttribute("role"))).toBe("option");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator("#canvas"))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await search.press("0");
    await expect(page.locator("body")).toHaveAttribute("data-character-switch-request", "9");
    await expect(dialog).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect(dialog).toBeHidden();
  } finally {
    await closeOffline(fixture);
  }
});

test("the modal confirms PvE departure, blocks click-through, and retains post-logout failure", async () => {
  const fixture = await launchCachedClient(
    "gw-character-switch-modal-e2e-",
    {},
    (userData) => writeFile(
      path.join(userData, "settings.json"),
      JSON.stringify({ gwonmacTools: true, travelPalette: true }),
    ),
  );
  try {
    const { page } = fixture;
    await startGameInput(page);
    await page.evaluate(() => {
      document.getElementById("loading")?.classList.add("gone");
      const characters = [
        { name: "Private Alpha", characterKey: "0000000000000001", primaryProfession: 1, secondaryProfession: 0, characterType: "roleplaying" as const, campaign: 1, level: 20, mapId: 55 },
        { name: "Private Beta", characterKey: "0000000000000002", primaryProfession: 2, secondaryProfession: 3, characterType: "roleplaying" as const, campaign: 2, level: 20, mapId: 55 },
      ];
      let characterState = { status: "ready" as const, sequence: 12, selectedIndex: 0, characters };
      let phase: "idle" | "confirming" | "switching" | "failed" = "idle";
      let pendingKey: string | null = null;
      let context: CharacterSwitchContext = "pve-explorable";
      const listeners = new Set<() => void>();
      const emit = () => { for (const listener of listeners) listener(); };
      window.gwCharacterSwitchHost?.attach({
        get characters() { return characterState; },
        get action() {
          if (phase === "switching") return { status: "switching", stage: "logout" } as const;
          if (phase === "confirming") return { status: "confirming" } as const;
          if (phase === "failed") return { status: "failed", code: "selection-not-confirmed", retryable: false } as const;
          return { status: "idle" } as const;
        },
        usage: { formatVersion: 1, sequence: 0, entries: [] },
        get context() { return context; },
        request(characterKey) {
          pendingKey = characterKey;
          phase = context === "pve-explorable" ? "confirming" : "switching";
          emit();
        },
        confirm() {
          if (phase !== "confirming" || pendingKey === null) return;
          document.body.dataset.characterSwitchRequest = pendingKey;
          phase = "switching";
          emit();
        },
        cancelConfirmation() { pendingKey = null; phase = "idle"; emit(); },
        reset() { pendingKey = null; phase = "idle"; emit(); },
        diagnostics: () => ({ version: 1, stage: "unavailable", lastCode: "play-path-unproved" }),
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
      });
      const canvas = document.getElementById("canvas")!;
      canvas.addEventListener("click", () => {
        document.body.dataset.gameClicks = String(Number(document.body.dataset.gameClicks ?? "0") + 1);
      });
      Object.assign(window, {
        __characterSwitchTestSet(nextPhase: typeof phase, nextContext: CharacterSwitchContext) {
          phase = nextPhase;
          context = nextContext;
          emit();
        },
        __characterSwitchTestRefreshCharacters() {
          characterState = {
            status: "ready",
            sequence: 13,
            selectedIndex: 1,
            characters: [characters[1]!, characters[0]!],
          };
          emit();
        },
      });
    });

    const dialog = page.getByRole("dialog", { name: "Switch Character" });
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect(dialog).toBeVisible();
    await page.locator("#character-switch-root").click({ position: { x: 8, y: 8 } });
    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).not.toHaveAttribute("data-game-clicks", /.*/u);

    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await page.getByRole("option", { name: /Switch to Private Beta/u }).click();
    await expect(page.getByRole("heading", { name: "Leave this area?" })).toBeVisible();
    await expect.poll(() => isDomActiveElement(page.getByRole("button", { name: "Stay here" }))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Switch Character" })).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await page.getByRole("option", { name: /Switch to Private Beta/u }).click();
    await page.getByRole("button", { name: "Stay here" }).click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await page.getByRole("option", { name: /Switch to Private Beta/u }).click();
    await page.evaluate(() => {
      const target = window as typeof window & {
        __characterSwitchTestRefreshCharacters(): void;
      };
      target.__characterSwitchTestRefreshCharacters();
    });
    await page.getByRole("button", { name: "Leave and switch" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute("data-character-switch-request", "0000000000000002");

    await page.evaluate(() => {
      const target = window as typeof window & {
        __characterSwitchTestSet(phase: "idle" | "confirming" | "switching" | "failed", context: CharacterSwitchContext): void;
      };
      target.__characterSwitchTestSet("idle", "character-select");
      window.dispatchEvent(new CustomEvent("gw:character-toggle", { cancelable: true }));
    });
    await expect(dialog).toBeHidden();
    await page.evaluate(() => {
      const target = window as typeof window & {
        __characterSwitchTestSet(phase: "idle" | "confirming" | "switching" | "failed", context: CharacterSwitchContext): void;
      };
      target.__characterSwitchTestSet("failed", "character-select");
      window.dispatchEvent(new CustomEvent("gw:character-toggle", { cancelable: true }));
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText(
      "Automatic switching stopped. Continue from the Guild Wars character selector.",
    );
    await dialog.getByRole("button", { name: "Close Switch Character" }).click();
    await expect(dialog).toBeHidden();

    await page.evaluate(async () => {
      const target = window as typeof window & {
        __characterSwitchTestSet(phase: "idle" | "confirming" | "switching" | "failed", context: CharacterSwitchContext): void;
      };
      target.__characterSwitchTestSet("idle", "outpost");
      const specifier = "./travel-palette.js";
      const module = await import(specifier) as
        typeof import("../../src/renderer/travel-palette.js");
      const palette = module.createTravelPalette(document.body, {
        travel: () => undefined,
        unavailable: () => null,
      });
      palette.setEnabled(true);
      window.dispatchEvent(new CustomEvent("gw:travel-toggle", { cancelable: true, detail: {} }));
    });
    const travel = page.getByRole("dialog", { name: "Quick Travel" });
    await expect(travel).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect(travel).toBeHidden();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:travel-toggle", { cancelable: true, detail: {} }),
    ));
    await expect(dialog).toBeHidden();
    await expect(travel).toBeVisible();
  } finally {
    await closeOffline(fixture);
  }
});
