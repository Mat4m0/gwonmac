/**
 * The one account-local game reload workflow.
 *
 * Main owns navigation and native sockets, so renderer warnings, menu actions,
 * and crash recovery all ask this owner instead of reloading their own page.
 * A relog intent belongs to the exact BrowserWindow and is consumed once by
 * the replacement document; it cannot move with focus to another account.
 */
import type { BrowserWindow } from "electron";
import type {
  AppSettings,
  GameReloadCause,
  RendererCommandOutcome,
} from "../shared/contracts.js";
import type { SocketManager } from "./core/sockets.js";
import { logEvent } from "./diagnostics.js";
import { sendRendererCommand } from "./renderer-commands.js";
import { windowRegistry } from "./window-registry.js";

const RELOAD_SYNC_BUDGET_MS = 1_500;

export interface GameReloadDependencies {
  sockets: SocketManager;
  getSettings(): Promise<AppSettings>;
  rendererUrl: string;
}

export class GameReloader {
  private readonly active = new WeakMap<BrowserWindow, Promise<void>>();
  private readonly relogIntents = new WeakSet<BrowserWindow>();

  constructor(private readonly dependencies: GameReloadDependencies) {}

  reload(win: BrowserWindow, cause: GameReloadCause): Promise<void> {
    const current = this.active.get(win);
    if (current) return current;

    const operation = this.reloadOnce(win, cause).finally(() => {
      this.active.delete(win);
    });
    this.active.set(win, operation);
    return operation;
  }

  claimRelogIntent(win: BrowserWindow): boolean {
    if (!this.relogIntents.has(win)) return false;
    this.relogIntents.delete(win);
    return true;
  }

  private async reloadOnce(
    win: BrowserWindow,
    cause: GameReloadCause,
  ): Promise<void> {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    const ownerId = windowRegistry.requireDiagnosticOwnerForWindow(win);
    const autoRelogAfterReload = await this.dependencies.getSettings()
      .then((settings) => settings.autoRelogAfterReload)
      .catch(() => false);
    if (autoRelogAfterReload) this.relogIntents.add(win);
    else this.relogIntents.delete(win);

    logEvent({ k: "gameReload.requested", cause }, ownerId);
    const sync = sendRendererCommand(win, { type: "filesystem.sync" });
    this.dependencies.sockets.closeAll(win.webContents.id);
    const syncOutcome = await boundedSync(sync);
    if (syncOutcome !== "completed") {
      logEvent({ k: "gameReload.syncIncomplete", outcome: syncOutcome }, ownerId);
    }

    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      this.relogIntents.delete(win);
      return;
    }
    try {
      await win.loadURL(this.dependencies.rendererUrl);
      logEvent({ k: "gameReload.loaded", cause }, ownerId);
    } catch (error) {
      this.relogIntents.delete(win);
      throw error;
    }
  }
}

async function boundedSync(
  sync: Promise<RendererCommandOutcome>,
): Promise<RendererCommandOutcome> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const budget = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), RELOAD_SYNC_BUDGET_MS);
  });
  const outcome = await Promise.race([sync, budget]);
  if (timer !== null) clearTimeout(timer);
  return outcome;
}
