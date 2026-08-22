/**
 * Window-scoped shortcut interception and recording before Guild Wars sees a key.
 * Settings stay durable elsewhere; this controller owns only the live input state.
 */
import type { BrowserWindow } from "electron";
import type { GameTextEditCommand } from "../shared/contracts.js";
import {
  resolveShortcuts,
  shortcutFromInput,
  shortcutMatches,
  type ShortcutAction,
  type ShortcutCaptureResult,
  type ShortcutOverrides,
} from "../shared/keyboard-shortcuts.js";
import { recordMainInput } from './input-trace.js';

const tracedKey = (key: string) => {
  if (["Meta", "Control", "Shift", "Alt"].includes(key)) return 'modifier' as const;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(key)) {
    return 'navigation' as const;
  }
  if (["Backspace", "Delete", "Enter", "Escape"].includes(key)) return 'editing' as const;
  return key.length === 1 ? 'printable' as const : 'other' as const;
};

interface ShortcutActions {
  run(action: ShortcutAction): void;
  edit(command: GameTextEditCommand): void;
}

type ClaimedKey = 'capture' | 'shortcut' | GameTextEditCommand;

const claimedDecision = (claim: ClaimedKey): 'capture' | 'shortcut' =>
  claim === 'capture' ? 'capture' : 'shortcut';

const isTextEditClaim = (claim: ClaimedKey): claim is GameTextEditCommand =>
  claim !== 'capture' && claim !== 'shortcut';

const textEditCommand = (input: Electron.Input): GameTextEditCommand | null => {
  if (!input.meta || input.control || input.shift || input.alt) return null;
  if (input.code === 'KeyA') return 'selectAll';
  if (input.code === 'KeyC') return 'copy';
  if (input.code === 'KeyV') return 'paste';
  if (input.code === 'KeyX') return 'cut';
  return null;
};

class WindowShortcuts {
  readonly #actions: ShortcutActions;
  #shortcuts = resolveShortcuts({});
  #capture: ((result: ShortcutCaptureResult) => void) | null = null;
  #claimedCodes = new Map<string, ClaimedKey>();

  constructor(win: BrowserWindow, actions: ShortcutActions) {
    this.#actions = actions;
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyUp") {
        const decision = this.#claimedCodes.get(input.code);
        if (decision && isTextEditClaim(decision) && input.control && !input.meta) {
          recordMainInput(win, {
            source: 'main', kind: 'native-key', phase: 'up',
            key: tracedKey(input.key), repeat: false,
            decision: 'forwarded',
          });
          return;
        }
        recordMainInput(win, {
          source: 'main', kind: 'native-key', phase: 'up',
          key: tracedKey(input.key), repeat: false,
          decision: decision ? claimedDecision(decision) : 'forwarded',
        });
        if (decision) {
          this.#claimedCodes.delete(input.code);
          event.preventDefault();
        }
        return;
      }
      if (input.type !== "keyDown") return;
      const claimed = this.#claimedCodes.get(input.code);
      if (claimed) {
        // The translated Guild Wars chord deliberately reuses A or X while
        // the physical Command shortcut remains claimed. Let only that exact
        // Control event through; repeats and unmodified leaks stay contained.
        if (isTextEditClaim(claimed) && input.control && !input.meta) {
          recordMainInput(win, {
            source: 'main', kind: 'native-key', phase: 'down',
            key: tracedKey(input.key), repeat: input.isAutoRepeat,
            decision: 'forwarded',
          });
          return;
        }
        recordMainInput(win, {
          source: 'main', kind: 'native-key', phase: 'down',
          key: tracedKey(input.key), repeat: input.isAutoRepeat,
          decision: claimedDecision(claimed),
        });
        event.preventDefault();
        return;
      }
      if (this.#capture) {
        if (["Meta", "Control", "Shift", "Alt"].includes(input.key)) return;
        if (input.key === "Tab") return;
        event.preventDefault();
        recordMainInput(win, {
          source: 'main', kind: 'native-key', phase: 'down',
          key: tracedKey(input.key), repeat: input.isAutoRepeat, decision: 'capture',
        });
        this.#claimedCodes.set(input.code, 'capture');
        if (input.key === "Escape") {
          this.#finish({ status: "cancelled" });
          return;
        }
        if (input.key === "Backspace" || input.key === "Delete") {
          this.#finish({ status: "cleared" });
          return;
        }
        const binding = shortcutFromInput(input);
        this.#finish(binding
          ? { status: "captured", binding }
          : { status: "invalid" });
        return;
      }
      const edit = textEditCommand(input);
      if (edit) {
        event.preventDefault();
        recordMainInput(win, {
          source: 'main', kind: 'native-key', phase: 'down',
          key: tracedKey(input.key), repeat: input.isAutoRepeat,
          decision: 'shortcut',
        });
        this.#claimedCodes.set(input.code, edit);
        this.#actions.edit(edit);
        return;
      }
      for (const [action, binding] of Object.entries(this.#shortcuts)) {
        if (binding && shortcutMatches(binding, input)) {
          recordMainInput(win, {
            source: 'main', kind: 'native-key', phase: 'down',
            key: tracedKey(input.key), repeat: input.isAutoRepeat, decision: 'shortcut',
          });
          event.preventDefault();
          this.#claimedCodes.set(input.code, 'shortcut');
          if (!input.isAutoRepeat) {
            this.#actions.run(action as ShortcutAction);
          }
          return;
        }
      }
      recordMainInput(win, {
        source: 'main', kind: 'native-key', phase: 'down',
        key: tracedKey(input.key), repeat: input.isAutoRepeat, decision: 'forwarded',
      });
    });
    win.on("blur", () => this.cancelCapture());
    win.on("closed", () => this.cancelCapture());
  }

  update(overrides: ShortcutOverrides): void {
    this.#shortcuts = resolveShortcuts(overrides);
  }

  capture(): Promise<ShortcutCaptureResult> {
    this.cancelCapture();
    return new Promise((resolve) => {
      this.#capture = resolve;
    });
  }

  cancelCapture(): void {
    this.#claimedCodes.clear();
    this.#finish({ status: "cancelled" });
  }

  release(code: string): void {
    this.#claimedCodes.delete(code);
  }

  #finish(result: ShortcutCaptureResult): void {
    const resolve = this.#capture;
    if (!resolve) return;
    this.#capture = null;
    resolve(result);
  }
}

const controllers = new WeakMap<BrowserWindow, WindowShortcuts>();

export function installWindowShortcuts(
  win: BrowserWindow,
  actions: ShortcutActions,
): void {
  controllers.set(win, new WindowShortcuts(win, actions));
}

export function updateWindowShortcuts(
  win: BrowserWindow,
  overrides: ShortcutOverrides,
): void {
  controllers.get(win)?.update(overrides);
}

export function captureWindowShortcut(
  win: BrowserWindow,
): Promise<ShortcutCaptureResult> {
  const controller = controllers.get(win);
  return controller
    ? controller.capture()
    : Promise.resolve({ status: "cancelled" });
}

export function cancelWindowShortcutCapture(win: BrowserWindow): void {
  controllers.get(win)?.cancelCapture();
}

/** Forget a release that AppKit consumed before `before-input-event`. */
export function releaseWindowShortcutKey(
  win: BrowserWindow,
  code: string,
): void {
  controllers.get(win)?.release(code);
}
