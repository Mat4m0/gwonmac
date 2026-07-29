import type {
  BrowserWindow,
  WebContents,
} from "electron";

export type SenderContext =
  | {
    readonly kind: "control";
    readonly window: BrowserWindow;
  }
  | {
    readonly kind: "game";
    readonly window: BrowserWindow;
    readonly profileId: null;
    readonly slot: number;
  };

type GameContext = Extract<SenderContext, { kind: "game" }>;
type ControlContext = Extract<SenderContext, { kind: "control" }>;

export type RendererOwnerRelease = (
  ownerId: number,
  reason: "reload" | "crash" | "destroyed",
) => void;

interface Registered {
  readonly context: SenderContext;
  readonly contents: WebContents;
  readonly disposeListeners: () => void;
}

export class WindowRegistry {
  private readonly byContentsId = new Map<number, Registered>();
  private readonly maxGameWindows: 1 | 2;
  private readonly releaseOwner: RendererOwnerRelease;
  private nextSlot = 1;

  constructor(
    maxGameWindows: 1 | 2 = 1,
    releaseOwner: RendererOwnerRelease = () => {},
  ) {
    this.maxGameWindows = maxGameWindows;
    this.releaseOwner = releaseOwner;
  }

  registerGame(window: BrowserWindow): GameContext {
    if (this.gameWindows().length >= this.maxGameWindows) {
      throw new Error("game window limit reached");
    }
    const context: GameContext = Object.freeze({
      kind: "game",
      window,
      profileId: null,
      slot: this.nextSlot,
    });
    this.nextSlot += 1;
    this.register(context);
    return context;
  }

  registerControl(window: BrowserWindow): ControlContext {
    if (this.controlWindow() !== null) {
      throw new Error("control window already registered");
    }
    const context: ControlContext = Object.freeze({
      kind: "control",
      window,
    });
    this.register(context);
    return context;
  }

  private register(context: SenderContext): void {
    const { window } = context;
    const contents = window.webContents;
    if (
      window.isDestroyed()
      || contents.isDestroyed()
      || this.byContentsId.has(contents.id)
    ) {
      throw new Error("window is not registrable");
    }

    const onNavigation = (
      details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (details.isMainFrame && !details.isSameDocument) {
        this.releaseOwner(contents.id, "reload");
      }
    };
    const onCrash = (): void => {
      this.releaseOwner(contents.id, "crash");
      this.unregisterExact(contents);
    };
    const onDestroyed = (): void => {
      this.releaseOwner(contents.id, "destroyed");
      this.unregisterExact(contents);
    };
    const onClosed = (): void => {
      this.unregisterExact(contents);
    };
    contents.on("did-start-navigation", onNavigation);
    contents.once("render-process-gone", onCrash);
    contents.once("destroyed", onDestroyed);
    window.once("closed", onClosed);

    this.byContentsId.set(contents.id, {
      context,
      contents,
      disposeListeners: () => {
        contents.off("did-start-navigation", onNavigation);
        contents.off("render-process-gone", onCrash);
        contents.off("destroyed", onDestroyed);
        window.off("closed", onClosed);
      },
    });
  }

  contextFor(contents: WebContents): SenderContext | null {
    const registered = this.byContentsId.get(contents.id);
    if (
      !registered
      || registered.contents !== contents
      || contents.isDestroyed()
      || registered.context.window.isDestroyed()
      || registered.context.window.webContents !== contents
    ) {
      return null;
    }
    return registered.context;
  }

  contextForWindow(window: BrowserWindow): SenderContext | null {
    const context = this.contextFor(window.webContents);
    return context?.window === window ? context : null;
  }

  gameWindow(): BrowserWindow | null {
    const games = this.gameWindows();
    return games.length === 1 ? games[0]!.window : null;
  }

  gameWindows(): readonly GameContext[] {
    return Object.freeze(
      [...this.byContentsId.values()]
        .map((registered) => registered.context)
        .filter((context): context is GameContext => context.kind === "game"),
    );
  }

  controlWindow(): BrowserWindow | null {
    for (const registered of this.byContentsId.values()) {
      if (registered.context.kind === "control") {
        return registered.context.window;
      }
    }
    return null;
  }

  unregister(window: BrowserWindow): boolean {
    return this.unregisterExact(window.webContents);
  }

  private unregisterExact(contents: WebContents): boolean {
    const registered = this.byContentsId.get(contents.id);
    if (!registered || registered.contents !== contents) return false;
    registered.disposeListeners();
    this.byContentsId.delete(contents.id);
    return true;
  }

  clear(): void {
    for (const registered of this.byContentsId.values()) {
      registered.disposeListeners();
    }
    this.byContentsId.clear();
  }
}
