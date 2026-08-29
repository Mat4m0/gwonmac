/**
 * The one owner for presenting the launcher and profile game windows.
 *
 * The registry remains the source of window identity. This coordinator keeps
 * macOS reveal, focus, hide, and final-game-close policy in one place without
 * retaining another window map or changing normal BrowserWindow levels.
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

interface ApplicationPresentation {
  readonly dock?: { show(): void };
  focus(options: { steal: true }): void;
}

interface PreventableClose {
  preventDefault(): void;
}

export class WindowCoordinator<Window extends PresentableWindow> {
  readonly #application: ApplicationPresentation;
  readonly #registry: WindowRegistry<Window>;

  constructor(
    application: ApplicationPresentation,
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
   * has moved on. New game windows are already shown inactive while loading.
   */
  revealAsyncGameIfLauncherFocused(win: Window): boolean {
    if (!this.#registry.launcherWindow()?.isFocused()) return false;
    return this.revealGame(win);
  }

  private present(win: Window, activateApp: boolean): void {
    this.#application.dock?.show();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    if (activateApp) this.#application.focus({ steal: true });
    win.focus();
  }
}
