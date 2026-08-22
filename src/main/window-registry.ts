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
  readonly webContents: {
    readonly id: number;
    getOSProcessId?(): number;
  };
  isDestroyed(): boolean;
  isFocused(): boolean;
}

interface Entry<Window extends RegisteredWindow> {
  readonly win: Window;
  readonly context: WindowContext;
  readonly diagnosticOwnerId: number | null;
}

export class WindowRegistry<Window extends RegisteredWindow = BrowserWindow> {
  readonly #byWebContents = new Map<number, Entry<Window>>();
  readonly #profileWindows = new Map<ProfileId, Window>();
  readonly #webContentsIds = new WeakMap<Window, number>();
  #singleGameWindow: Window | null = null;
  #hubWindow: Window | null = null;

  register(
    win: Window,
    context: WindowContext,
    diagnosticOwnerId: number | null = null,
  ): void {
    const id = win.webContents.id;
    if (this.#byWebContents.has(id)) {
      throw new AppError("validation", "window is already registered");
    }
    if (context.mode === "single") {
      if (this.#singleGameWindow && !this.#singleGameWindow.isDestroyed()) {
        throw new AppError("validation", "Single Account already has a game window");
      }
      this.#singleGameWindow = win;
    } else if (context.role === "hub") {
      if (this.#hubWindow && !this.#hubWindow.isDestroyed()) {
        throw new AppError("validation", "Multiple Accounts already has a Hub window");
      }
      this.#hubWindow = win;
    } else {
      const existing = this.#profileWindows.get(context.profileId);
      if (existing && !existing.isDestroyed()) {
        throw new AppError("validation", "profile already has a game window");
      }
      this.#profileWindows.set(context.profileId, win);
    }
    this.#webContentsIds.set(win, id);
    this.#byWebContents.set(id, { win, context, diagnosticOwnerId });
  }

  unregister(win: Window): void {
    const id = this.#webContentsIds.get(win);
    if (id === undefined) return;
    const entry = this.#byWebContents.get(id);
    if (!entry || entry.win !== win) return;
    this.#byWebContents.delete(id);
    this.#webContentsIds.delete(win);
    if (entry.context.mode === "single") {
      if (this.#singleGameWindow === win) this.#singleGameWindow = null;
    } else if (entry.context.role === "hub") {
      if (this.#hubWindow === win) this.#hubWindow = null;
    } else {
      if (this.#profileWindows.get(entry.context.profileId) === win) {
        this.#profileWindows.delete(entry.context.profileId);
      }
    }
  }

  contextForWebContents(id: number): WindowContext | null {
    const entry = this.#byWebContents.get(id);
    return entry && !entry.win.isDestroyed() ? entry.context : null;
  }

  windowForWebContents(id: number): Window | null {
    const entry = this.#byWebContents.get(id);
    return entry && !entry.win.isDestroyed() ? entry.win : null;
  }

  diagnosticOwnerForWindow(win: Window): number | null {
    const id = this.#webContentsIds.get(win);
    if (id === undefined) return null;
    const entry = this.#byWebContents.get(id);
    return entry?.win === win && !win.isDestroyed()
      ? entry.diagnosticOwnerId
      : null;
  }

  diagnosticOwnerForWebContents(id: number): number | null {
    const entry = this.#byWebContents.get(id);
    return entry && !entry.win.isDestroyed()
      ? entry.diagnosticOwnerId
      : null;
  }

  /** Resolve a live renderer process without treating an ambiguous PID as owned. */
  diagnosticOwnerForProcessId(processId: number): number | null {
    let ownerId: number | null = null;
    for (const { win, diagnosticOwnerId } of this.#byWebContents.values()) {
      let rendererProcessId: number | undefined;
      try {
        rendererProcessId = win.webContents.getOSProcessId?.();
      } catch {
        continue;
      }
      if (
        win.isDestroyed()
        || diagnosticOwnerId === null
        || rendererProcessId !== processId
      ) continue;
      if (ownerId !== null && ownerId !== diagnosticOwnerId) return null;
      ownerId = diagnosticOwnerId;
    }
    return ownerId;
  }

  singleGameWindow(): Window | null {
    return this.#singleGameWindow && !this.#singleGameWindow.isDestroyed()
      ? this.#singleGameWindow
      : null;
  }

  hubWindow(): Window | null {
    return this.#hubWindow && !this.#hubWindow.isDestroyed()
      ? this.#hubWindow
      : null;
  }

  profileWindow(profileId: ProfileId): Window | null {
    const win = this.#profileWindows.get(profileId);
    return win && !win.isDestroyed() ? win : null;
  }

  windows(
    predicate: (context: WindowContext) => boolean = () => true,
  ): Window[] {
    const result: Window[] = [];
    for (const { win, context } of this.#byWebContents.values()) {
      if (!win.isDestroyed() && predicate(context)) result.push(win);
    }
    return result;
  }

  gameWindows(): Window[] {
    return this.windows((context) => context.role === "game");
  }

  focusedWindow(): Window | null {
    return this.windows().find((win) => win.isFocused()) ?? null;
  }

  focusedGameWindow(): Window | null {
    return this.gameWindows().find((win) => win.isFocused()) ?? null;
  }

  focusedOrSoleGameWindow(): Window | null {
    const games = this.gameWindows();
    return games.find((win) => win.isFocused())
      ?? (games.length === 1 ? games[0] ?? null : null);
  }
}

/** The process has one native-window authority. */
export const windowRegistry = new WindowRegistry<BrowserWindow>();
