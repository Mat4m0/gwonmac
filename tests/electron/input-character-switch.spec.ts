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

test("a 27-character account uses the Hub carousel and preserves search, identity and preferences", async () => {
  const fixture = await launchPlayableClient("gw-character-switch-e2e-");
  try {
    const { app, page } = fixture;
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
        const focusedKey = document.activeElement?.getAttribute("data-character-key");
        characterState = { ...characterState, sequence: 11, characters: characters.filter(character => character.characterKey !== focusedKey) };
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
    await expect(search).toBeVisible();
    const selected = list.locator(".character-switch-row[data-selected=true]");
    await expect(selected).toContainText("Character 01");
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);
    const carouselCapacity = await list.locator("li").count();
    await expect(list.locator(".character-switch-slot")).toHaveCount(0);
    await expect(list.getByRole("option")).toHaveCount(carouselCapacity);
    await page.evaluate(() => window.dispatchEvent(new Event("test-character-five")));
    await expect(search).toBeVisible();
    await expect(list.getByRole("option")).toHaveCount(Math.min(5, carouselCapacity));
    const firstCardOffset = await list.evaluate(node => {
      const first = node.querySelector(".character-switch-row")!.getBoundingClientRect();
      return first.left - node.getBoundingClientRect().left;
    });
    expect(firstCardOffset).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.dispatchEvent(new Event("test-character-all")));
    await expect(list.getByRole("option")).toHaveCount(carouselCapacity);
    await page.keyboard.press("ArrowLeft");
    await expect(selected).toContainText("Rudolph Prime");
    await expect(list.locator(".character-switch-slot")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(selected).toContainText("Character 01");
    await page.keyboard.press("ArrowRight");
    await expect(selected).toContainText("Character 02");
    await page.keyboard.press("ArrowLeft");
    await expect(selected).toContainText("Character 01");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await expect(selected).toContainText("Character 01");
    await page.keyboard.press("ArrowDown");
    await expect(selected).toContainText("Character 01");
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);
    await page.keyboard.type("rud");
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await expect(search).toHaveValue("rud");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(selected).toContainText("Rudolph Prime");
    await search.press("ArrowDown");
    await app.evaluate(({ BrowserWindow }, url) => {
      const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.webContents;
      contents?.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['meta'] });
      contents?.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['meta'] });
    }, page.url());
    await expect(search).toBeFocused();
    await expect.poll(() => search.evaluate(input => input instanceof HTMLInputElement
      ? [input.selectionStart, input.selectionEnd] : null)).toEqual([0, 3]);
    await search.press("Escape");
    await search.press("ArrowDown");
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    const horizontalLayout = dialog.getByRole("radio", { name: /Horizontal/u });
    const verticalLayout = dialog.getByRole("radio", { name: /Vertical/u });
    const searchSetting = dialog.getByRole("checkbox", { name: /Show search bar/u });
    await expect(horizontalLayout).toBeHidden();
    await expect(verticalLayout).toBeHidden();
    await expect(searchSetting).toBeChecked();
    await searchSetting.uncheck();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    await expect.poll(() => isDomActiveElement(selected)).toBe(true);

    await dialog.getByRole("button", { name: "Character Switch settings" }).click();
    await searchSetting.check();

    await page.keyboard.press("Escape");
    await expect(search).toBeVisible();
    await expect(dialog).toHaveAttribute("data-layout", "horizontal");
    await expect(list.getByRole("option")).toHaveCount(carouselCapacity);
    await expect(list.locator("img")).toHaveCount(carouselCapacity);
    await expect(list.locator(".character-switch-meta").first()).toContainText("Lv 20");
    await expect(list.locator(".character-switch-meta").first()).toContainText("Lion's Arch");
    await expect(list.getByRole("option").first()).toHaveAccessibleName(/Level 20, Lion's Arch/u);
    await page.keyboard.type("rud");
    await expect.poll(() => isDomActiveElement(search)).toBe(true);
    await expect(search).toHaveValue("rud");
    await expect(list.getByRole("option")).toHaveCount(1);
    await search.press("Escape");
    await search.press("ArrowDown");
    const focusedRow = list.getByRole("option").nth(1);
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
      "Lv 20 · Lion's Arch",
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
    await expect(list.getByRole("option")).toHaveCount(carouselCapacity);
    await search.press("1");
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);

    await search.fill("rud");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option")).toContainText("Rudolph Prime");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(list.getByRole("option")).toHaveCount(carouselCapacity);
    await expect(list).toHaveAttribute("role", "listbox");

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
    await selected.press("0");
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
          phase = context === "pve-explorable" ? "confirming"
            : context === "loading" ? "failed" : "switching";
          if (phase === "switching") document.body.dataset.characterSwitchRequest = characterKey;
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
    await expect(search).toBeVisible();
    await expect.poll(() => isDomActiveElement(
      dialog.getByRole("option", { name: /Private Alpha/u }),
    )).toBe(true);
    await page.locator("#hub").click({ position: { x: 8, y: 8 } });
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

    // At the selector, the last entered character is selectable, not current.
    await page.evaluate(() => {
      const target = window as typeof window & {
        __characterSwitchTestSet(phase: "idle" | "confirming" | "switching" | "failed", context: CharacterSwitchContext): void;
      };
      delete document.body.dataset.characterSwitchRequest;
      target.__characterSwitchTestSet("idle", "character-select");
      window.dispatchEvent(new CustomEvent("gw:character-toggle", { cancelable: true }));
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("option", { name: /Switch to Private Alpha/u }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute(
      "data-character-switch-request",
      "0000000000000001",
    );

    // Hub selects directly at the selector without opening Switch Character.
    const hub = page.getByRole("dialog", { name: "Hub", exact: true });
    const hubSearch = hub.getByRole("combobox", { name: "Search people, places, builds" });
    await page.evaluate(() => {
      const target = window as typeof window & {
        __characterSwitchTestSet(phase: "idle" | "confirming" | "switching" | "failed", context: CharacterSwitchContext): void;
      };
      delete document.body.dataset.characterSwitchRequest;
      target.__characterSwitchTestSet("idle", "character-select");
      window.gwHub?.show();
    });
    await hubSearch.fill("char Private Beta");
    await hub.locator('[data-id="character:0000000000000002"]').click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-character-switch-request",
      "0000000000000002",
    );
    await expect(hub).toBeHidden();
    await expect(dialog).toBeHidden();

    // A refused Hub request is reported in Hub instead of opening the palette.
    await page.evaluate(() => {
      const target = window as typeof window & {
        __characterSwitchTestSet(phase: "idle" | "confirming" | "switching" | "failed", context: CharacterSwitchContext): void;
      };
      delete document.body.dataset.characterSwitchRequest;
      target.__characterSwitchTestSet("idle", "loading");
      window.gwHub?.show();
    });
    await hubSearch.fill("char Private Beta");
    await hub.locator('[data-id="character:0000000000000002"]').click();
    await expect(hub.locator(".hub-status")).toContainText("Automatic switching stopped.");
    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).not.toHaveAttribute("data-character-switch-request", /.*/u);
    await page.getByRole("button", { name: "Close Hub", exact: true }).click();
    await expect(hub).toBeHidden();

    // PvE departure from Hub hands off to the palette's confirmation.
    await page.evaluate(() => {
      const target = window as typeof window & {
        __characterSwitchTestSet(phase: "idle" | "confirming" | "switching" | "failed", context: CharacterSwitchContext): void;
      };
      target.__characterSwitchTestSet("idle", "pve-explorable");
      window.gwHub?.show();
    });
    await hubSearch.fill("char Private Beta");
    await hub.locator('[data-id="character:0000000000000002"]').click();
    await expect(page.getByRole("heading", { name: "Leave this area?" })).toBeVisible();
    await page.getByRole("button", { name: "Leave and switch" }).click();
    await expect(hub).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute(
      "data-character-switch-request",
      "0000000000000002",
    );
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
    await page.getByRole("button", { name: "Close Hub", exact: true }).click();
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
    const travel = page.getByRole("dialog", { name: "Hub", exact: true });
    await expect(travel).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(
      new CustomEvent("gw:character-toggle", { cancelable: true }),
    ));
    await expect(travel).toBeVisible();
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
