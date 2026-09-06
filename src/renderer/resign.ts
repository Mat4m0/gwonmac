/**
 * Owns the confirmed, fixed Resign command for one active Tools generation.
 * The certified game mailbox performs submission without touching chat input.
 */
import { featureActivationRequested } from "../shared/feature-contracts.js";

let active: { enabled: boolean; enqueue(): number } | null = null;

export function installResignCommand(exports: WebAssembly.Exports) {
  const configure = exports.enhancement_configure_resign;
  const enqueue = exports.enhancement_resign;
  if (typeof configure !== "function" || typeof enqueue !== "function") {
    throw new Error("The certified Resign command is unavailable.");
  }
  const command = { enabled: false, enqueue: () => Number(enqueue()) };
  configure(0);
  active = command;
  return {
    update(enabled: boolean) {
      command.enabled = enabled;
      configure(enabled ? 1 : 0);
    },
    dispose() {
      command.enabled = false;
      configure(0);
      if (active === command) active = null;
    },
  };
}

export function resignFromGame(): void {
  const context = window.gwCharacterSwitch?.context;
  if (!featureActivationRequested("resign", window.gwToolsSettings())
    || !active?.enabled || (context !== "outpost" && context !== "pve-explorable")) {
    throw new Error("Resign requires an enabled, certified Tools session in PvE.");
  }
  const field = document.getElementById("osk-input-text");
  if (field instanceof HTMLInputElement && field.value !== "") {
    throw new Error("Finish or clear your chat draft before resigning.");
  }
  if (!document.hasFocus() || document.activeElement !== document.getElementById("canvas")) {
    throw new Error("Return to Guild Wars and close other windows before resigning.");
  }
  if (active.enqueue() !== 1) throw new Error("Guild Wars command queue is busy.");
}
