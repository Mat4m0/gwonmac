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
import type { logEvent } from "./diagnostics.js";

const RELOAD_SYNC_BUDGET_MS = 1_500;
const RELOG_INTENT_BUDGET_MS = 5 * 60_000;

type RelogIntent = Readonly<{
  expiresAt: number;
  sourceDocumentId: number;
}>;

export interface GameReloadDependencies {
  sockets: Pick<SocketManager, "closeAll">;
  getSettings(): Promise<AppSettings>;
  diagnosticOwner(win: BrowserWindow): number;
  record: typeof logEvent;
  sync(win: BrowserWindow): Promise<RendererCommandOutcome>;
  load(win: BrowserWindow, url: string): Promise<void>;
  rendererUrl: string;
}

export class GameReloader {
  private readonly active = new WeakMap<BrowserWindow, Promise<void>>();
  private readonly relogIntents = new WeakMap<BrowserWindow, RelogIntent>();
  private readonly dependencies: GameReloadDependencies;

  constructor(dependencies: GameReloadDependencies) {
    this.dependencies = dependencies;
  }

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
    const intent = this.relogIntents.get(win);
    if (!intent) return false;
    if (
      Date.now() > intent.expiresAt
      || win.webContents.mainFrame.routingId === intent.sourceDocumentId
    ) {
      if (Date.now() > intent.expiresAt) this.relogIntents.delete(win);
      return false;
    }
    this.relogIntents.delete(win);
    return true;
  }

  private async reloadOnce(
    win: BrowserWindow,
    cause: GameReloadCause,
  ): Promise<void> {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    const ownerId = this.dependencies.diagnosticOwner(win);
    const autoRelogAfterReload = (
      await this.dependencies.getSettings()
    ).autoRelogAfterReload;
    if (autoRelogAfterReload) {
      this.relogIntents.set(win, {
        expiresAt: Date.now() + RELOG_INTENT_BUDGET_MS,
        sourceDocumentId: win.webContents.mainFrame.routingId,
      });
    }
    else this.relogIntents.delete(win);

    this.dependencies.record({ k: "gameReload.requested", cause }, ownerId);
    const sync = this.dependencies.sync(win);
    this.dependencies.sockets.closeAll(win.webContents.id);
    const syncOutcome = await boundedSync(sync);
    if (syncOutcome !== "completed") {
      this.dependencies.record(
        { k: "gameReload.syncIncomplete", outcome: syncOutcome },
        ownerId,
      );
    }

    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      this.relogIntents.delete(win);
      return;
    }
    try {
      await this.dependencies.load(win, this.dependencies.rendererUrl);
      this.dependencies.record({ k: "gameReload.loaded", cause }, ownerId);
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
