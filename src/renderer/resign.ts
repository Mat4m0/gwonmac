/**
 * Owns the confirmed, fixed Resign command for one active Tools generation.
 * The certified game mailbox performs submission without touching chat input.
 */
import { createResignDialog, type ResignHandoff } from "./resign-dialog.js";
import { featureActivationRequested } from "../shared/feature-contracts.js";
import { matchHubRows, type HubSource } from "../shared/hub.js";

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
  const show = (event: Event) => {
    if (!command.enabled) return;
    event.preventDefault();
    showResignConfirmation();
  };
  window.addEventListener("gw:resign-show", show);
  const listeners = new Set<() => void>();
  /**
   * Resign's Hub row, from the one owner of its refusals: the reason shows before Enter
   * (HUB-135, HUB-251). The row hands the Hub over to the confirmation, and Cancel hands the
   * task back, with its search and selection (HUB-250).
   */
  const source: HubSource = {
    search(query) {
      if (!command.enabled || !query.trim()) return [];
      const reason = unavailable();
      return matchHubRows([{
        id: "resign", title: "Resign…", detail: "Asks before sending /resign · PvE only", keywords: "surrender give up",
        group: "Commands", action: "Review resign", consequential: true, destructive: true, ...(reason ? { unavailable: reason } : {}),
        run() {
          const hub = window.gwHub;
          if (!hub) { showResignConfirmation(); return; }
          hub.suspend();
          showResignConfirmation({ confirmed: () => hub.close(), cancelled: () => hub.show() });
        },
      }], query);
    },
    setVisible() {},
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const detachHub = window.gwHub?.attach(source);
  return {
    update(enabled: boolean) {
      command.enabled = enabled;
      if (!enabled) command.dialog?.close();
      configure(enabled ? 1 : 0);
      for (const listener of listeners) listener();
    },
    dispose() {
      detachHub?.();
      listeners.clear();
      window.removeEventListener("gw:resign-show", show);
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

/** Shows the confirmation; a Hub row passes the handoff that returns to it on Cancel. */
export function showResignConfirmation(handoff?: ResignHandoff): void {
  const command = active;
  if (!command?.enabled || !featureActivationRequested("resign", window.gwToolsSettings())) return;
  command.dialog ??= createResignDialog(document.body, unavailable, () => {
    if (active !== command || command.enqueue() !== 1) {
      throw new Error("Guild Wars command queue is busy. Close this dialog and try again.");
    }
  });
  command.dialog.show(handoff);
}
