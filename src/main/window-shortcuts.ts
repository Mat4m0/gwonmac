/**
 * Window-scoped shortcut interception and recording before Guild Wars sees a key.
 * Settings stay durable elsewhere; this controller owns only the live input state.
 */
import type { BrowserWindow } from "electron";
import type { AppSettings, GameTextEditCommand } from "../shared/contracts.js";
import { featureActivationRequested } from "../shared/feature-contracts.js";
import {
  resolveShortcuts,
  shortcutFromInput,
  shortcutMatches,
  type ShortcutAction,
  type ShortcutCaptureResult,
} from "../shared/keyboard-shortcuts.js";
import { recordMainInput } from './input-trace.js';
import {
  isSkillKeyKeyboardCode,
  type SkillKeyBinding,
  type SkillKeyCaptureResult,
} from "../shared/skill-key-bindings.js";

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
  quitOrReload(): void | Promise<void>;
  recordCommandQ?(
    phase: "claimed" | "repeat-contained" | "rearmed",
    reason: "none" | "keyup" | "dialog-settled" | "appkit-release" | "error",
  ): void;
}

type ClaimedKey = 'capture' | 'skill-capture' | 'shortcut' | GameTextEditCommand;

const claimedDecision = (claim: ClaimedKey): 'capture' | 'shortcut' =>
  claim === 'capture' || claim === 'skill-capture' ? 'capture' : 'shortcut';

const isTextEditClaim = (claim: ClaimedKey): claim is GameTextEditCommand =>
  claim !== 'capture' && claim !== 'skill-capture' && claim !== 'shortcut';

const isModifierCode = (code: string): boolean =>
  /^(?:Meta|Control|Shift|Alt)(?:Left|Right)$/u.test(code);

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
  #shortcuts = resolveShortcuts({
    "character.switch": null,
    "tools.toggle": null,
    "trade.toggle": null,
    "storage.open": null,
    "travel.open": null,
    "cartography.grid.toggle": null,
    "cartography.walkability.toggle": null,
  });
  #capture: ((result: ShortcutCaptureResult) => void) | null = null;
  #skillCapture: ((result: SkillKeyCaptureResult) => void) | null = null;
  #claimedCodes = new Map<string, ClaimedKey>();

  constructor(
    win: BrowserWindow,
    actions: ShortcutActions,
  ) {
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
          if (input.code === "KeyQ") this.#recordCommandQ("rearmed", "keyup");
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
        if (input.code === "KeyQ") {
          this.#recordCommandQ("repeat-contained", "none");
        }
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
      if (this.#skillCapture) {
        event.preventDefault();
        recordMainInput(win, {
          source: 'main', kind: 'native-key', phase: 'down',
          key: tracedKey(input.key), repeat: input.isAutoRepeat, decision: 'capture',
        });
        this.#claimedCodes.set(input.code, 'skill-capture');
        if (isModifierCode(input.code) || input.isAutoRepeat) return;
        this.#finishSkillCapture(isSkillKeyKeyboardCode(input.code)
          ? {
              status: "captured",
              binding: {
                input: { kind: "keyboard", code: input.code },
                modifiers: {
                  control: input.control,
                  option: input.alt,
                  shift: input.shift,
                  command: input.meta,
                },
              },
            }
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
      if (
        input.meta &&
        !input.control &&
        !input.shift &&
        !input.alt &&
        input.code === "KeyQ"
      ) {
        event.preventDefault();
        recordMainInput(win, {
          source: 'main', kind: 'native-key', phase: 'down',
          key: tracedKey(input.key), repeat: input.isAutoRepeat,
          decision: 'shortcut',
        });
        this.#claimedCodes.set(input.code, 'shortcut');
        this.#recordCommandQ("claimed", "none");
        if (!input.isAutoRepeat) {
          // AppKit gives the native sheet ownership before the physical Q-up
          // reaches webContents. Keep repeats contained while the sheet is
          // open, then re-arm Q when its operation settles instead of waiting
          // for a release Electron may never deliver.
          const rearm = (reason: "dialog-settled" | "error") => {
            if (this.#claimedCodes.delete(input.code)) {
              this.#recordCommandQ("rearmed", reason);
            }
          };
          try {
            void Promise.resolve(this.#actions.quitOrReload()).then(
              () => rearm("dialog-settled"),
              (error) => {
                console.error('quit or reload shortcut failed', error);
                rearm("error");
              },
            );
          } catch (error) {
            console.error('quit or reload shortcut failed', error);
            rearm("error");
          }
        }
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

  update(settings: Pick<
    AppSettings,
    | "gwonmacTools"
    | "buildLibrary"
    | "tradeChat"
    | "xunlaiStorage"
    | "travelPalette"
    | "shortcutOverrides"
    | "characterSwitchEnabled"
    | "cartographyEnabled"
  >): void {
    const resolved = resolveShortcuts(settings.shortcutOverrides);
    this.#shortcuts = {
      "character.switch": featureActivationRequested("characterSwitch", settings)
        ? resolved["character.switch"] : null,
      "tools.toggle": featureActivationRequested("buildLibrary", settings)
        ? resolved["tools.toggle"]
        : null,
      "trade.toggle": featureActivationRequested("tradeChat", settings)
        ? resolved["trade.toggle"]
        : null,
      "storage.open": featureActivationRequested("xunlaiStorage", settings)
        ? resolved["storage.open"]
        : null,
      "travel.open": featureActivationRequested("travel", settings)
        ? resolved["travel.open"]
        : null,
      "cartography.grid.toggle": featureActivationRequested("cartography", settings)
        ? resolved["cartography.grid.toggle"] : null,
      "cartography.walkability.toggle": featureActivationRequested("cartography", settings)
        ? resolved["cartography.walkability.toggle"] : null,
    };
  }

  capture(): Promise<ShortcutCaptureResult> {
    this.cancelCapture();
    return new Promise((resolve) => {
      this.#capture = resolve;
    });
  }

  captureSkillKey(): Promise<SkillKeyCaptureResult> {
    this.cancelCapture();
    return new Promise((resolve) => {
      this.#skillCapture = resolve;
    });
  }

  cancelCapture(): void {
    this.#claimedCodes.clear();
    this.#finish({ status: "cancelled" });
    this.#finishSkillCapture({ status: "cancelled" });
  }

  cancelSkillCapture(): void {
    // Keep already claimed physical codes until their key-up arrives. A mouse
    // or wheel can win the renderer race while modifiers are still held, and
    // leaking those releases into Guild Wars would create an unmatched edge.
    this.#finishSkillCapture({ status: "cancelled" });
  }

  captureSkillPointer(binding: SkillKeyBinding): boolean {
    if (!this.#skillCapture) return false;
    this.#finishSkillCapture({ status: "captured", binding });
    return true;
  }

  release(code: string): void {
    const claimed = this.#claimedCodes.delete(code);
    if (claimed && code === "KeyQ") {
      this.#recordCommandQ("rearmed", "appkit-release");
    }
  }

  #recordCommandQ(
    phase: "claimed" | "repeat-contained" | "rearmed",
    reason: "none" | "keyup" | "dialog-settled" | "appkit-release" | "error",
  ): void {
    try {
      this.#actions.recordCommandQ?.(phase, reason);
    } catch {
      // Observation must never alter shortcut containment or rearming.
    }
  }

  #finish(result: ShortcutCaptureResult): void {
    const resolve = this.#capture;
    if (!resolve) return;
    this.#capture = null;
    resolve(result);
  }


  #finishSkillCapture(result: SkillKeyCaptureResult): void {
    const resolve = this.#skillCapture;
    if (!resolve) return;
    this.#skillCapture = null;
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
  settings: AppSettings,
): void {
  controllers.get(win)?.update(settings);
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

export function captureWindowSkillKey(
  win: BrowserWindow,
): Promise<SkillKeyCaptureResult> {
  const controller = controllers.get(win);
  return controller
    ? controller.captureSkillKey()
    : Promise.resolve({ status: "cancelled" });
}

export function captureWindowSkillKeyPointer(
  win: BrowserWindow,
  binding: SkillKeyBinding,
): boolean {
  return controllers.get(win)?.captureSkillPointer(binding) ?? false;
}

export function cancelWindowSkillKeyCapture(win: BrowserWindow): void {
  controllers.get(win)?.cancelSkillCapture();
}

/** Forget a release that AppKit consumed before `before-input-event`. */
export function releaseWindowShortcutKey(
  win: BrowserWindow,
  code: string,
): void {
  controllers.get(win)?.release(code);
}
