/**
 * Owns the renderer half of certified Quick Item Move and publishes the
 * current Control/Shift state to its transformed WASM callbacks.
 */
export { QUICK_ITEM_MOVE_SCRATCH_BYTES } from "../shared/quick-item-move-contract.js";

export type QuickItemMoveInstallation = Readonly<{
  update(enabled: boolean): void;
  dispose(): void;
}>;

type Configure = (enabled: number, scratchPointer: number) => number;
type SetModifiers = (modifiers: number) => number;

export function quickItemMoveExports(
  exports: WebAssembly.Exports,
): Readonly<{ configure: Configure; setModifiers: SetModifiers }> | null {
  const configure = exports.enhancement_configure_quick_item_move;
  const setModifiers = exports.enhancement_quick_item_move_modifiers;
  return typeof configure === "function" && typeof setModifiers === "function"
    ? Object.freeze({ configure: configure as Configure, setModifiers: setModifiers as SetModifiers })
    : null;
}

export function installQuickItemMove(input: Readonly<{
  configure: Configure;
  setModifiers: SetModifiers;
  scratchPointer: number;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}>): QuickItemMoveInstallation {
  const target = input.target ?? window;
  let enabled = false;
  let modifiers = 0;
  const publishModifiers = (event?: Pick<KeyboardEvent, "ctrlKey" | "shiftKey">) => {
    const next = event ? (event.ctrlKey ? 1 : 0) | (event.shiftKey ? 2 : 0) : 0;
    if (next === modifiers) return;
    modifiers = next;
    input.setModifiers(next);
  };
  const onKeyboard = (event: Event) => publishModifiers(event as KeyboardEvent);
  const onBlur = () => publishModifiers();
  input.configure(0, input.scratchPointer);
  input.setModifiers(0);
  target.addEventListener("keydown", onKeyboard, true);
  target.addEventListener("keyup", onKeyboard, true);
  target.addEventListener("blur", onBlur, true);
  let disposed = false;

  return Object.freeze({
    update(nextEnabled) {
      if (disposed) return;
      if (nextEnabled === enabled) return;
      enabled = nextEnabled;
      input.configure(enabled ? 1 : 0, input.scratchPointer);
      if (!enabled) publishModifiers();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener("keydown", onKeyboard, true);
      target.removeEventListener("keyup", onKeyboard, true);
      target.removeEventListener("blur", onBlur, true);
      input.configure(0, input.scratchPointer);
      modifiers = 0;
      input.setModifiers(0);
    },
  });
}
