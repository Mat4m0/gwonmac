import { expect, test, type Page } from "@playwright/test";
import type {
  GwControlApi,
  GwNativeApi,
  ProfileSummary,
} from "../../src/shared/contracts.js";
import { closeOffline, launchOffline } from "./fixtures.mjs";

type ControlWindow = Window & { gwControl: GwControlApi };
type GameWindow = Window & { gwNative: GwNativeApi };

async function profiles(page: Page): Promise<readonly ProfileSummary[]> {
  return page.evaluate(
    () => (window as unknown as ControlWindow).gwControl.profiles.list(),
  );
}

async function launch(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (profileId) =>
      (window as unknown as ControlWindow).gwControl.profiles.launch(profileId),
    id,
  );
}

async function close(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (profileId) =>
      (window as unknown as ControlWindow).gwControl.profiles.close(profileId),
    id,
  );
}

async function writeSentinel(page: Page, value: string): Promise<void> {
  await page.evaluate(async (sentinel) => {
    const opened = indexedDB.open("profile-isolation", 1);
    opened.onupgradeneeded = () => opened.result.createObjectStore("values");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("values", "readwrite");
      transaction.objectStore("values").put(sentinel, "sentinel");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, value);
}

async function readSentinel(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const opened = indexedDB.open("profile-isolation", 1);
    opened.onupgradeneeded = () => opened.result.createObjectStore("values");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction("values", "readonly");
      const request = transaction.objectStore("values").get("sentinel");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return typeof value === "string" ? value : null;
  });
}

async function saveCredentials(
  page: Page,
  username: string,
  password: string,
): Promise<boolean> {
  try {
    await page.evaluate(
      (value) =>
        (window as unknown as GameWindow).gwNative.credentials.save(value),
      { username, password },
    );
    return true;
  } catch (error) {
    if (process.platform !== "linux") throw error;
    expect(String(error)).toContain("credential encryption is unavailable");
    return false;
  }
}

test("manager isolates profiles and preserves visible-window lifecycle", async () => {
  const fixture = await launchOffline(
    "gw-profiles-e2e-",
    { GW_TEST_DIRECT_GAME: "0" },
  );
  try {
    const control = fixture.page;
    await expect(control).toHaveURL("gw://control/");
    expect(
      await control.evaluate(() => ({
        control: typeof (window as unknown as Partial<ControlWindow>).gwControl,
        game: typeof (window as unknown as Partial<GameWindow>).gwNative,
      })),
    ).toEqual({ control: "object", game: "undefined" });

    const initial = await profiles(control);
    expect(initial).toHaveLength(1);
    const first = initial[0]!;
    await control.evaluate(() =>
      (window as unknown as ControlWindow).gwControl.profiles.create(
        '<img src=x onerror="throw 1">',
      ),
    );
    await expect(control.locator(".profile")).toHaveCount(2);
    await expect(control.locator(".profile img")).toHaveCount(0);
    const second = (await profiles(control)).find(
      (profile) => profile.id !== first.id,
    )!;

    let gameOpened = fixture.app.waitForEvent("window");
    await launch(control, first.id);
    let game = await gameOpened;
    await game.waitForLoadState("domcontentloaded");
    await expect(game).toHaveURL("gw://app/");
    expect(
      await game.evaluate(
        () => typeof (window as unknown as Partial<ControlWindow>).gwControl,
      ),
    ).toBe("undefined");
    const credentialPersistenceAvailable = await saveCredentials(
      game,
      "profile-a",
      "secret-a",
    );
    await writeSentinel(game, "profile-a");
    expect((await profiles(control)).find(({ id }) => id === first.id)?.status)
      .toBe("running");

    let gameClosed = game.waitForEvent("close");
    await close(control, first.id);
    await gameClosed;
    gameOpened = fixture.app.waitForEvent("window");
    await launch(control, second.id);
    game = await gameOpened;
    await game.waitForLoadState("domcontentloaded");
    expect(
      await game.evaluate(
        () => (window as unknown as GameWindow).gwNative.credentials.load(),
      ),
    ).toEqual({ state: "absent" });
    expect(await readSentinel(game)).toBeNull();
    expect(
      await saveCredentials(game, "profile-b", "secret-b"),
    ).toBe(credentialPersistenceAvailable);
    await writeSentinel(game, "profile-b");

    gameClosed = game.waitForEvent("close");
    await close(control, second.id);
    await gameClosed;
    gameOpened = fixture.app.waitForEvent("window");
    await launch(control, first.id);
    game = await gameOpened;
    await game.waitForLoadState("domcontentloaded");
    expect(
      await game.evaluate(
        () => (window as unknown as GameWindow).gwNative.credentials.load(),
      ),
    ).toEqual(
      credentialPersistenceAvailable
        ? {
            state: "available",
            credentials: { username: "profile-a", password: "secret-a" },
          }
        : { state: "absent" },
    );
    expect(await readSentinel(game)).toBe("profile-a");

    const gameWindow = await fixture.app.browserWindow(game);
    const controlWindow = await fixture.app.browserWindow(control);
    await controlWindow.evaluate((win) => win.close());
    await control.waitForEvent("close");
    expect(game.isClosed()).toBe(false);
    const reopenedControl = fixture.app.waitForEvent("window");
    await fixture.app.evaluate(({ app }) => {
      app.emit("second-instance", {} as never, [], "");
    });
    const controlAgain = await reopenedControl;
    await controlAgain.waitForLoadState("domcontentloaded");
    await expect(controlAgain).toHaveURL("gw://control/");
    expect(game.isClosed()).toBe(false);
    await (await fixture.app.browserWindow(controlAgain)).evaluate((win) =>
      win.close());
    await controlAgain.waitForEvent("close");
    const appClosed = fixture.app.waitForEvent("close");
    await gameWindow.evaluate((win) => win.close());
    await appClosed;
  } finally {
    await closeOffline(fixture);
  }
});

test("Level 2 tracing removes profile labels and restores the manager", async () => {
  const fixture = await launchOffline(
    "gw-profile-trace-e2e-",
    { GW_TEST_DIRECT_GAME: "0" },
  );
  try {
    const control = fixture.page;
    const [profile] = await profiles(control);
    expect(profile).toBeDefined();
    const gameOpened = fixture.app.waitForEvent("window");
    await launch(control, profile!.id);
    const game = await gameOpened;
    await game.waitForLoadState("domcontentloaded");

    const controlClosed = control.waitForEvent("close");
    await fixture.app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById("start-chromium-trace")?.click();
    });
    await controlClosed;
    await expect(game.locator("#capture-status")).toBeVisible();

    const controlReopened = fixture.app.waitForEvent("window");
    await fixture.app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById("stop-capture")?.click();
    });
    const restored = await controlReopened;
    await restored.waitForLoadState("domcontentloaded");
    await expect(restored).toHaveURL("gw://control/");
    await expect(game.locator("#capture-status")).toBeHidden();
  } finally {
    await closeOffline(fixture);
  }
});
