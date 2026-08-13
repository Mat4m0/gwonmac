/**
 * The authority that binds every native window to one immutable app context.
 *
 * IPC and lifecycle code resolve context from `webContents.id`; renderers do
 * not submit profile identifiers. The registry also enforces the one-window
 * per Multi profile invariant and keeps transient launch state out of disk.
 */
import type { BrowserWindow } from "electron";
import type { ProfileId } from "../shared/multiple-accounts.js";
import { AppError } from "../shared/errors.js";

export type WindowContext =
  | Readonly<{ mode: "single"; role: "game" }>
  | Readonly<{ mode: "multi"; role: "hub" }>
  | Readonly<{ mode: "multi"; role: "game"; profileId: ProfileId }>;

interface RegisteredWindow {
  readonly webContents: { readonly id: number };
  isDestroyed(): boolean;
}

interface Entry {
  readonly win: RegisteredWindow;
  readonly context: WindowContext;
}

export class WindowRegistry {
  readonly #byWebContents = new Map<number, Entry>();
  readonly #profileWindows = new Map<ProfileId, RegisteredWindow>();

  register(win: RegisteredWindow, context: WindowContext): void {
    const id = win.webContents.id;
    if (this.#byWebContents.has(id)) {
      throw new AppError("validation", "window is already registered");
    }
    if (context.mode === "multi" && context.role === "game") {
      const existing = this.#profileWindows.get(context.profileId);
      if (existing && !existing.isDestroyed()) {
        throw new AppError("validation", "profile already has a game window");
      }
      this.#profileWindows.set(context.profileId, win);
    }
    this.#byWebContents.set(id, { win, context });
  }

  unregister(win: RegisteredWindow): void {
    const entry = this.#byWebContents.get(win.webContents.id);
    if (!entry || entry.win !== win) return;
    this.#byWebContents.delete(win.webContents.id);
    if (entry.context.mode === "multi" && entry.context.role === "game") {
      if (this.#profileWindows.get(entry.context.profileId) === win) {
        this.#profileWindows.delete(entry.context.profileId);
      }
    }
  }

  contextForWebContents(id: number): WindowContext | null {
    const entry = this.#byWebContents.get(id);
    return entry && !entry.win.isDestroyed() ? entry.context : null;
  }

  profileWindow(profileId: ProfileId): BrowserWindow | null {
    const win = this.#profileWindows.get(profileId);
    return win && !win.isDestroyed() ? win as BrowserWindow : null;
  }

  windows(
    predicate: (context: WindowContext) => boolean = () => true,
  ): BrowserWindow[] {
    const result: BrowserWindow[] = [];
    for (const { win, context } of this.#byWebContents.values()) {
      if (!win.isDestroyed() && predicate(context)) result.push(win as BrowserWindow);
    }
    return result;
  }

  gameWindows(): BrowserWindow[] {
    return this.windows((context) => context.role === "game");
  }
}
