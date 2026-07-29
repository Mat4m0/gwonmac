import type {
  RendererCommand,
  RendererCommandCompletion,
  RendererCommandOutcome,
} from "../../shared/contracts.js";

interface NavigationDetails {
  readonly isMainFrame: boolean;
  readonly isSameDocument: boolean;
}

export interface RendererCommandContents {
  readonly id: number;
  isDestroyed(): boolean;
  isCrashed(): boolean;
  send(channel: string, id: number, command: RendererCommand): void;
  once(
    event: "destroyed" | "render-process-gone" | "did-finish-load",
    listener: () => void,
  ): void;
  on(
    event: "did-start-navigation",
    listener: (details: NavigationDetails) => void,
  ): void;
  off(
    event:
      | "destroyed"
      | "render-process-gone"
      | "did-finish-load"
      | "did-start-navigation",
    listener: (() => void) | ((details: NavigationDetails) => void),
  ): void;
}

export interface RendererCommandWindow {
  isDestroyed(): boolean;
  readonly webContents: RendererCommandContents;
}

interface Timer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMER: Timer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Pending {
  readonly webContentsId: number;
  settle(outcome: RendererCommandOutcome): void;
}

/** Owns command settlement independently of Electron's IPC registration. */
export class RendererCommandBroker {
  private readonly pending = new Map<number, Pending>();
  private lastCommandId = 0;
  private readonly channel: string;
  private readonly timeoutMs: number;
  private readonly timer: Timer;

  constructor(
    channel: string,
    timeoutMs: number,
    timer: Timer = REAL_TIMER,
  ) {
    this.channel = channel;
    this.timeoutMs = timeoutMs;
    this.timer = timer;
  }

  complete(
    senderId: number,
    id: unknown,
    outcome: unknown,
  ): void {
    if (
      typeof id !== "number"
      || (outcome !== "completed" && outcome !== "failed")
    ) {
      return;
    }
    const entry = this.pending.get(id);
    if (!entry || entry.webContentsId !== senderId) return;
    entry.settle(outcome as RendererCommandCompletion);
  }

  send(
    win: RendererCommandWindow | null,
    command: RendererCommand,
  ): Promise<RendererCommandOutcome> {
    if (
      !win
      || win.isDestroyed()
      || win.webContents.isDestroyed()
      || win.webContents.isCrashed()
    ) {
      return Promise.resolve("failed");
    }
    const contents = win.webContents;
    const id = (this.lastCommandId += 1);
    return new Promise<RendererCommandOutcome>((resolve) => {
      let settled = false;
      const deadline = this.timer.set(
        () => settle("timed-out"),
        this.timeoutMs,
      );
      const settle = (outcome: RendererCommandOutcome): void => {
        if (settled) return;
        settled = true;
        this.timer.clear(deadline);
        this.pending.delete(id);
        contents.off("destroyed", failed);
        contents.off("render-process-gone", failed);
        contents.off("did-finish-load", failed);
        contents.off("did-start-navigation", abandon);
        resolve(outcome);
      };
      const failed = (): void => settle("failed");
      const abandon = (details: NavigationDetails): void => {
        if (details.isMainFrame && !details.isSameDocument) failed();
      };
      this.pending.set(id, {
        webContentsId: contents.id,
        settle,
      });
      contents.once("destroyed", failed);
      contents.once("render-process-gone", failed);
      contents.once("did-finish-load", failed);
      contents.on("did-start-navigation", abandon);
      try {
        contents.send(this.channel, id, command);
      } catch {
        failed();
      }
    });
  }
}
