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
  launchPlayableClient,
} from "./fixtures.mjs";
import { startGameInput } from "./input-helpers.js";

test("a 27-character account uses the horizontal carousel or vertical list", async () => {
  const fixture = await launchPlayableClient("gw-character-switch-e2e-");
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
      let characterState = {
        status: "ready" as const,
        sequence: 8,
        selectedIndex: 0,
        characters,
      };
      const listeners = new Set<() => void>();
      window.addEventListener("test-character-refresh", () => {
        for (const listener of listeners) listener();
      }, { once: true });
      window.addEventListener("test-character-five", () => {
        characterState = { ...characterState, sequence: 9, characters: characters.slice(0, 5) };
        for (const listener of listeners) listener();
      }, { once: true });
      window.addEventListener("test-character-all", () => {
        characterState = { ...characterState, sequence: 10, characters };
        for (const listener of listeners) listener();
      }, { once: true });
      window.addEventListener("test-character-remove-focused", () => {
        characterState = { ...characterState, sequence: 11, characters: characters.filter((_, index) => index !== 1) };
        for (const listener of listeners) listener();
      }, { once: true });
      window.addEventListener("test-character-restore", () => {
        characterState = { ...characterState, sequence: 12, characters };
        for (const listener of listeners) listener();
      }, { once: true });
      window.gwCharacterSwitchHost?.attach({
        get characters() {
          return characterState;
        },
        get action() {
          return switching
            ? ({ status: "switching", stage: "logout" } as const)
            : ({ status: "idle" } as const);
        },
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
    const list = dialog.locator("#character-switch-list");
    await expect(dialog).toBeVisible();
    await expect(search).toBeHidden();
    const selected = list.locator(".character-switch-row[data-selected=true]");
    await expect(selected).toContainText("Character 01");
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);
    const carouselCapacity = await list.locator("li").count();
    const edgeSlotCount = Math.floor(carouselCapacity / 2);
    await expect(list.locator(".character-switch-slot")).toHaveCount(edgeSlotCount);
    await page.evaluate(() => window.dispatchEvent(new Event("test-character-five")));
    const fiveCharacterCount = carouselCapacity >= 5 ? 5 : Math.ceil(carouselCapacity / 2);
    await expect(list.getByRole("option")).toHaveCount(fiveCharacterCount);
    await expect(list.locator(".character-switch-slot")).toHaveCount(
      carouselCapacity - fiveCharacterCount,
    );
    if (carouselCapacity >= 5) {
      const groupCentreOffset = await list.evaluate((node) => {
        const cards = [...node.querySelectorAll<HTMLElement>(".character-switch-row")];
        const first = cards.at(0)?.getBoundingClientRect();
        const last = cards.at(-1)?.getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        if (!first || !last) return Number.POSITIVE_INFINITY;
        return Math.abs((first.left + last.right) / 2 - (bounds.left + bounds.right) / 2);
      });
      expect(groupCentreOffset).toBeLessThan(1);
    }
    await page.evaluate(() => window.dispatchEvent(new Event("test-character-all")));
    await expect(list.getByRole("option")).toHaveCount(edgeSlotCount + 1);
    await expect(list.locator(".character-switch-slot")).toHaveCount(edgeSlotCount);
    await page.keyboard.press("ArrowLeft");
    await expect(selected).toContainText("Rudolph Prime");
    await expect(list.locator(".character-switch-slot")).toHaveCount(edgeSlotCount);
    await page.keyboard.press("ArrowRight");
    await expect(selected).toContainText("Character 01");
    await page.keyboard.press("ArrowRight");
    await expect(selected).toContainText("Character 02");
    await page.keyboard.press("ArrowLeft");
    await expect(selected).toContainText("Character 01");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    const horizontalLayout = dialog.getByRole("radio", { name: /Horizontal/u });
    const verticalLayout = dialog.getByRole("radio", { name: /Vertical/u });
    const searchSetting = dialog.getByRole("checkbox", { name: /Enable search/u });
    await expect(horizontalLayout).toBeChecked();
    await expect(searchSetting).not.toBeChecked();
    await searchSetting.check();
    await page.keyboard.press("Escape");
    await expect(search).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await search.press("ArrowDown");
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);
    await page.keyboard.type("u");
    await expect(search).toHaveValue("u");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(selected).toContainText("Rudolph Prime");
    await search.press("Escape");

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    await verticalLayout.check();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveAttribute("data-layout", "vertical");
    await expect(list.getByRole("button")).toHaveCount(27);
    await expect(list.locator("img")).toHaveCount(27);
    await expect.poll(() => list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);
    for (let index = 0; index < 10; index += 1) await selected.press("ArrowDown");
    await expect(list.locator(".character-switch-row[data-selected=true]")).toContainText(
      "Character 10",
    );
    await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect(list.locator(".character-switch-meta").first()).toContainText("Level 20");
    await expect(list.locator(".character-switch-meta").first()).toContainText("Lion's Arch");
    await expect(list.getByRole("button").first()).toHaveAccessibleName(
      /Level 20, Lion's Arch/u,
    );
    const focusedRow = list.getByRole("button").nth(1);
    await focusedRow.focus();
    const focusedName = await focusedRow.getAttribute("aria-label");
    await page.evaluate(() => window.dispatchEvent(new Event("test-character-refresh")));
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"))).toBe(focusedName);
    await page.evaluate(() => window.dispatchEvent(new Event("test-character-remove-focused")));
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("test-character-restore")));

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    const professionSetting = dialog.getByRole("checkbox", { name: /Show profession/u });
    const levelSetting = dialog.getByRole("checkbox", { name: /Show level/u });
    const locationSetting = dialog.getByRole("checkbox", { name: /Show known location/u });
    await expect(professionSetting).toBeChecked();
    await expect(levelSetting).toBeChecked();
    await expect(locationSetting).toBeChecked();

    await professionSetting.uncheck();
    await expect(professionSetting).toBeEnabled();
    await expect.poll(() => page.evaluate(async () => (await window.gwNative.settings.get()).characterSwitchProfession)).toBe(false);
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
    await page.setViewportSize({ width: 320, height: 256 });
    const compactBounds = await dialog.locator(".character-switch-panel").boundingBox();
    await expect.poll(async () =>
      (await dialog.locator(".character-switch-panel").boundingBox())?.y ?? -1
    ).toBeGreaterThanOrEqual(7);
    expect((compactBounds?.y ?? 0) + (compactBounds?.height ?? 0)).toBeLessThanOrEqual(248);
    await expect(dialog.locator(".character-switch-footer")).toBeInViewport();
    await page.setViewportSize({ width: 1280, height: 720 });

    await search.fill("Character");
    await expect(list.getByRole("option")).toHaveCount(26);
    await search.press("1");
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await search.fill("rud");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option")).toContainText("Rudolph Prime");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(list.getByRole("button")).toHaveCount(27);
    await expect(list).not.toHaveAttribute("role", "listbox");

    await search.press("Tab");
    await expect.poll(() => page.evaluate(() =>
      document.activeElement?.tagName)).toBe("BUTTON");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => isDomActiveElement(page.locator("#canvas"))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect(selected).toContainText("Character 01");
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);
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
  const fixture = await launchPlayableClient(
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
    const search = page.getByRole("combobox", { name: "Search characters" });
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect(dialog).toBeVisible();
    await expect(search).toBeHidden();
    await expect.poll(() => isDomActiveElement(
      dialog.getByRole("option", { name: /Private Alpha/u }),
    )).toBe(true);
    await page.locator("#character-switch-root").click({ position: { x: 8, y: 8 } });
    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).not.toHaveAttribute("data-game-clicks", /.*/u);

    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await dialog.getByRole("option", { name: /Switch to Private Beta/u }).click();
    await expect(page.getByRole("heading", { name: "Leave this area?" })).toBeVisible();
    await expect(page.locator("#character-switch-root")).toHaveAttribute(
      "aria-describedby",
      "character-switch-confirm-copy",
    );
    await expect.poll(() => isDomActiveElement(page.getByRole("button", { name: "Stay here" }))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Switch Character" })).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await dialog.getByRole("option", { name: /Switch to Private Beta/u }).click();
    await page.getByRole("button", { name: "Stay here" }).click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await dialog.getByRole("option", { name: /Switch to Private Beta/u }).click();
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
        guildHall: () => undefined,
        guildHallUnavailable: () => null,
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
