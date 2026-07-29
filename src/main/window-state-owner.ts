import { type BrowserWindow, screen } from "electron";
import {
  defaultWindowState,
  fitWindowStateToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowBounds,
  type WindowState,
} from "./core/window-state.js";
import { logEvent } from "./diagnostics.js";

function workAreas(): WindowBounds[] {
  return screen.getAllDisplays().map((display) => ({ ...display.workArea }));
}

function primaryWorkArea(): WindowBounds {
  return { ...screen.getPrimaryDisplay().workArea };
}

/**
 * Owns the mutable geometry and write queue for exactly one profile.
 *
 * Keeping this state beside the profile prevents a delayed save from one game
 * window from landing in the next profile's document after a sequential
 * switch.
 */
export class WindowStateOwner {
  private readonly filePath: string;
  private restored: WindowState | null = null;
  private lastNormalBounds: WindowBounds | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private write: Promise<void> = Promise.resolve();
  private window: BrowserWindow | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async prepare(): Promise<void> {
    const loaded = await loadWindowState(this.filePath, () => {
      logEvent({ k: "window.stateCorruptCleared" });
    });
    this.restored = loaded
      ? fitWindowStateToDisplays(loaded, workAreas(), primaryWorkArea())
      : null;
    this.lastNormalBounds = this.restored?.bounds ?? null;
    if (this.restored) {
      logEvent({
        k: "window.stateRestored",
        mode: this.restored.mode,
        width: this.restored.bounds.width,
        height: this.restored.bounds.height,
      });
    }
  }

  initialState(): WindowState | null {
    return this.restored
      ? fitWindowStateToDisplays(
          this.restored,
          workAreas(),
          primaryWorkArea(),
        )
      : null;
  }

  attach(win: BrowserWindow): void {
    if (this.window && !this.window.isDestroyed()) {
      throw new Error("profile window state already attached");
    }
    this.window = win;

    const rememberNormalBounds = (): void => {
      if (win.isFullScreen() || win.isMaximized()) return;
      this.lastNormalBounds = { ...win.getBounds() };
      this.schedule(win);
    };
    const persistMode = (): void => {
      void this.persist(win).catch(() => {
        logEvent({ k: "window.stateSaveFailed" });
      });
    };
    win.on("move", rememberNormalBounds);
    win.on("resize", rememberNormalBounds);
    win.on("maximize", persistMode);
    win.on("unmaximize", persistMode);
    win.on("enter-full-screen", persistMode);
    win.on("leave-full-screen", persistMode);
    win.once("closed", () => {
      if (this.window === win) this.window = null;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    });
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const win = this.window;
    if (win && !win.isDestroyed()) await this.persist(win);
    await this.write;
  }

  async reset(win: BrowserWindow | null = this.window): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const reset = defaultWindowState(primaryWorkArea());
    this.restored = reset;
    this.lastNormalBounds = reset.bounds;
    if (win && !win.isDestroyed()) {
      if (win.isFullScreen()) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5_000);
          win.once("leave-full-screen", () => {
            clearTimeout(timeout);
            resolve();
          });
          win.setFullScreen(false);
        });
      }
      if (win.isMaximized()) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5_000);
          win.once("unmaximize", () => {
            clearTimeout(timeout);
            resolve();
          });
          win.unmaximize();
        });
      }
      win.setBounds(reset.bounds);
    }
    const operation = this.write.then(() =>
      saveWindowState(this.filePath, reset),
    );
    this.write = operation.catch(() => undefined);
    await operation;
    logEvent({
      k: "window.stateReset",
      width: reset.bounds.width,
      height: reset.bounds.height,
    });
  }

  private current(win: BrowserWindow): WindowState {
    const mode = win.isFullScreen()
      ? "fullscreen"
      : win.isMaximized()
        ? "maximized"
        : "normal";
    if (mode === "normal") this.lastNormalBounds = { ...win.getBounds() };
    return {
      bounds:
        this.lastNormalBounds
        ?? fitWindowStateToDisplays(
          defaultWindowState(primaryWorkArea()),
          workAreas(),
          primaryWorkArea(),
        ).bounds,
      mode,
    };
  }

  private async persist(win: BrowserWindow): Promise<void> {
    if (win.isDestroyed() || this.window !== win) return;
    const state = this.current(win);
    this.restored = state;
    const operation = this.write.then(() =>
      saveWindowState(this.filePath, state),
    );
    this.write = operation.catch(() => undefined);
    await operation;
  }

  private schedule(win: BrowserWindow): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist(win).catch(() => {
        logEvent({ k: "window.stateSaveFailed" });
      });
    }, 300);
  }
}
