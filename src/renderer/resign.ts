/**
 * Owns the confirmed, fixed Resign command for one active Tools generation.
 * The certified game mailbox performs submission without touching chat input.
 */
import { createResignDialog } from "./resign-dialog.js";
import { featureActivationRequested } from "../shared/feature-contracts.js";

let active: { enabled: boolean; enqueue(): number; dialog: ReturnType<typeof createResignDialog> | null } | null = null;

export function installResignCommand(exports: WebAssembly.Exports) {
  const configure = exports.enhancement_configure_resign;
  const enqueue = exports.enhancement_resign;
  if (typeof configure !== "function" || typeof enqueue !== "function") {
    throw new Error("The certified Resign command is unavailable.");
  }
  const command: NonNullable<typeof active> = { enabled: false, enqueue: () => Number(enqueue()), dialog: null };
  configure(0);
  active = command;
  return {
    update(enabled: boolean) {
      command.enabled = enabled;
      if (!enabled) command.dialog?.close();
      configure(enabled ? 1 : 0);
    },
    dispose() {
      command.enabled = false;
      command.dialog?.dispose();
      configure(0);
      if (active === command) active = null;
    },
  };
}

function unavailable(): string | null {
  const context = window.gwCharacterSwitch?.context;
  if (!featureActivationRequested("resign", window.gwToolsSettings())
    || !active?.enabled || (context !== "outpost" && context !== "pve-explorable")) {
    return "Resign is available with Tools enabled in a PvE area.";
  }
  const field = document.getElementById("osk-input-text");
  if (field instanceof HTMLInputElement && field.value !== "") {
    return "Finish or clear your chat draft before resigning.";
  }
  if (!document.hasFocus()) return "Return to Guild Wars before resigning.";
  return null;
}

export function showResignConfirmation(): void {
  const command = active;
  if (!command?.enabled || !featureActivationRequested("resign", window.gwToolsSettings())) return;
  command.dialog ??= createResignDialog(document.body, unavailable, () => {
    if (active !== command || command.enqueue() !== 1) {
      throw new Error("Guild Wars command queue is busy. Close this dialog and try again.");
    }
  });
  command.dialog.show();
}
