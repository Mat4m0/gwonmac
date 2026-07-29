import type {
  AppSettings,
  AppSettingsPatch,
  DownloadProgress,
  PrefetchProgress,
} from "../shared/contracts.js";
import { DEFAULT_SETTINGS, IPC } from "../shared/contracts.js";
import { EMPTY_PREFETCH, INITIAL_PROGRESS } from "../shared/progress.js";
import { loadSettings, saveSettings } from "./core/settings.js";
import type { WindowRegistry } from "./window-registry.js";

interface OwnedClientRuntime {
  shutdown(): Promise<void>;
}

interface OwnedSocketManager {
  closeAll(ownerId?: number): void;
}

export interface AppRuntimeCleanup {
  clearBrowserCookies: () => Promise<void>;
  flushWindowState: (windows: WindowRegistry) => Promise<void>;
  stopDiagnostics: () => Promise<void>;
  updateLongRunningTaskFeedback: (
    progress: DownloadProgress,
    window: ReturnType<WindowRegistry["gameWindow"]>,
  ) => void;
}

export class AppRuntime<
  Client extends OwnedClientRuntime = OwnedClientRuntime,
  Sockets extends OwnedSocketManager = OwnedSocketManager,
> {
  readonly client: Client;
  readonly sockets: Sockets;
  readonly windows: WindowRegistry;
  private readonly settingsPath: string;
  private readonly cleanup: AppRuntimeCleanup;
  private readonly prefetch: PrefetchProgress = { ...EMPTY_PREFETCH };
  private settingsWrite: Promise<void> = Promise.resolve();
  private disposePromise: Promise<void> | null = null;

  constructor(
    client: Client,
    sockets: Sockets,
    windows: WindowRegistry,
    settingsPath: string,
    cleanup: AppRuntimeCleanup,
  ) {
    this.client = client;
    this.sockets = sockets;
    this.windows = windows;
    this.settingsPath = settingsPath;
    this.cleanup = cleanup;
  }

  getSettings(): Promise<AppSettings> {
    return loadSettings(this.settingsPath);
  }

  updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    const operation = this.settingsWrite.then(async () => {
      const current = await loadSettings(this.settingsPath);
      return saveSettings(this.settingsPath, { ...current, ...patch });
    });
    this.trackSettingsWrite(operation);
    return operation;
  }

  resetSettings(): Promise<AppSettings> {
    const operation = this.settingsWrite.then(() =>
      saveSettings(this.settingsPath, { ...DEFAULT_SETTINGS }),
    );
    this.trackSettingsWrite(operation);
    return operation;
  }

  publishProgress(next: DownloadProgress): void {
    this.cleanup.updateLongRunningTaskFeedback(
      next,
      this.windows.gameWindow(),
    );
    this.sendToGames(IPC.progressEvent, next);
  }

  publishPrefetch(next: PrefetchProgress): void {
    this.prefetch.completedChunks = next.completedChunks;
    this.prefetch.totalChunks = next.totalChunks;
    this.sendToGames(IPC.prefetchEvent, { ...this.prefetch });
  }

  private trackSettingsWrite(operation: Promise<unknown>): void {
    this.settingsWrite = operation.then(
      () => undefined,
      () => undefined,
    );
  }

  private sendToGames(channel: string, value: unknown): void {
    for (const context of this.windows.gameWindows()) {
      const win = context.window;
      if (
        win.isDestroyed()
        || win.webContents.isDestroyed()
        || win.webContents.isCrashed()
      ) {
        continue;
      }
      try {
        win.webContents.send(channel, value);
      } catch {
        // Renderer teardown can race a native progress callback.
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeOnce();
    return this.disposePromise;
  }

  private async disposeOnce(): Promise<void> {
    const failures: unknown[] = [];
    const attempt = async (operation: () => void | Promise<void>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };

    await attempt(() => this.cleanup.flushWindowState(this.windows));
    await attempt(() => this.settingsWrite);
    await attempt(() => this.sockets.closeAll());
    await attempt(() => {
      this.cleanup.updateLongRunningTaskFeedback(
        {
          ...INITIAL_PROGRESS,
          phase: "ready",
          label: "Quitting",
        },
        this.windows.gameWindow(),
      );
    });
    await attempt(() => this.client.shutdown());
    await attempt(this.cleanup.clearBrowserCookies);
    await attempt(this.cleanup.stopDiagnostics);
    this.windows.clear();

    if (failures.length > 0) {
      throw new AggregateError(failures, "application runtime cleanup failed");
    }
  }
}

export function ownedGameWindow(runtime: AppRuntime | null) {
  return runtime?.windows.gameWindow() ?? null;
}
