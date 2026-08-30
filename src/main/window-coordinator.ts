/**
 * The one owner for presenting the launcher and profile game windows.
 *
 * The registry remains the source of window identity. This coordinator keeps
 * reveal, focus, hide, attention, and final-game-close policy in one place
 * without retaining another window map or changing normal BrowserWindow levels.
 */
import type { WindowRegistry, RegisteredWindow } from "./window-registry.js";

interface PresentableWindow extends RegisteredWindow {
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  hide(): void;
  focus(): void;
}

interface ApplicationPresentation<Window> {
  readonly dock?: { show(): void };
  focus(options: { steal: true }): void;
  requestAttention?(win: Window): void;
}

interface PreventableClose {
  preventDefault(): void;
}

export class WindowCoordinator<Window extends PresentableWindow> {
  readonly #application: ApplicationPresentation<Window>;
  readonly #registry: WindowRegistry<Window>;
  #focusOrder: Window[] = [];
  #activationTarget: Window | null = null;

  constructor(
    application: ApplicationPresentation<Window>,
    registry: WindowRegistry<Window>,
  ) {
    this.#application = application;
    this.#registry = registry;
  }

  revealLauncher(options: { readonly activateApp?: boolean } = {}): boolean {
    const launcher = this.#registry.launcherWindow();
    if (!launcher) return false;
    this.present(launcher, options.activateApp ?? false);
    return true;
  }

  revealGame(
    win: Window,
    options: { readonly activateApp?: boolean } = {},
  ): boolean {
    if (win.isDestroyed()) return false;
    this.present(win, options.activateApp ?? false);
    return true;
  }

  /** Keep a most-recently-used order for every launcher and game window. */
  recordFocused(win: Window): void {
    const context = this.#registry.contextForWebContents(win.webContents.id);
    if (!context || win.isDestroyed()) return;
    this.#focusOrder = [
      win,
      ...this.#focusOrder.filter((candidate) => (
        candidate !== win && !candidate.isDestroyed()
      )),
    ];
  }

  /**
   * Freeze the front window while the app resigns active. macOS may focus a
   * different app window before Electron delivers `activate`; that incidental
   * focus must not replace the window the player actually left in front.
   */
  captureActivationTarget(): void {
    this.#activationTarget = this.#registry.focusedWindow()
      ?? this.#focusOrder.find((win) => this.usable(win))
      ?? null;
  }

  /** Restore the newest live window, falling back through the complete order. */
  restoreMostRecentWindow(): boolean {
    this.#focusOrder = this.#focusOrder.filter((win) => !win.isDestroyed());
    const candidates = [
      this.#activationTarget,
      ...this.#focusOrder,
      ...this.#registry.gameWindows(),
      this.#registry.launcherWindow(),
    ];
    this.#activationTarget = null;
    const preferred = candidates.find((win) => this.usable(win));
    if (!preferred) return false;
    this.present(preferred, false);
    return true;
  }

  /** Hide a closed launcher only while a profile keeps the application alive. */
  handleLauncherClose(event: PreventableClose): boolean {
    if (this.#registry.gameWindows().length === 0) return false;
    const launcher = this.#registry.launcherWindow();
    if (!launcher) return false;
    event.preventDefault();
    launcher.hide();
    return true;
  }

  /** Bring the launcher back only after the final profile window has closed. */
  afterGameClosed(options: { readonly activateApp?: boolean } = {}): boolean {
    if (this.#registry.gameWindows().length !== 0) return false;
    return this.revealLauncher(options);
  }

  /**
   * Complete a delayed Play request without stealing focus after the player
   * has moved on. Game windows stay hidden until their first submitted frame,
   * then appear inactive before this explicit launch-owner check may focus one.
   */
  revealAsyncGameIfLauncherFocused(win: Window): boolean {
    if (!this.#registry.launcherWindow()?.isFocused()) {
      this.#application.requestAttention?.(win);
      return false;
    }
    return this.revealGame(win);
  }

  private present(win: Window, activateApp: boolean): void {
    this.#application.dock?.show();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    if (activateApp) this.#application.focus({ steal: true });
    win.focus();
    this.recordFocused(win);
  }

  private usable(win: Window | null): win is Window {
    return win !== null
      && !win.isDestroyed()
      && (win.isVisible() || win.isMinimized());
  }
}
