/**
 * Owns typed, authorized registration for every renderer-to-main invoke.
 * Channel handlers provide validation and behavior; this boundary proves the sender.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { IPC, type InvokeChannel } from "../shared/contracts.js";
import { AllowlistError, errorCode } from "../shared/errors.js";
import { logEvent } from "./diagnostics.js";
import { senderRefusal, type SenderRole } from "./ipc-sender.js";
import type { WindowRegistry } from "./window-registry.js";

export type Parser<In> = (args: readonly unknown[]) => In;
type Run<In, Out> = (win: BrowserWindow, input: In) => Out | Promise<Out>;

interface ChannelDef<In, Out> {
  readonly parse: Parser<In>;
  readonly run: Run<In, Out>;
  readonly role: SenderRole;
}

/** Erases the invariant input type only after `channel()` checked the pair. */
export interface AnyChannelDef {
  readonly parse: Parser<unknown>;
  readonly run: Run<never, unknown>;
  readonly role: SenderRole;
}

export function channel<In, Out>(
  parse: Parser<In>,
  run: Run<In, Out>,
  role: SenderRole = "game",
): ChannelDef<In, Out> {
  return { parse, run, role };
}

export function registerChannelDefinitions(
  windows: WindowRegistry,
  handlers: Partial<Record<InvokeChannel, AnyChannelDef>>,
): void {
  for (const [key, definition] of Object.entries(handlers)) {
    const def = definition as ChannelDef<unknown, unknown>;
    const name = key as InvokeChannel;
    ipcMain.handle(IPC[name], async (event, ...args: unknown[]) => {
      const win = assertSender(windows, event, def.role);
      let input: unknown;
      try {
        input = def.parse(args);
      } catch (error) {
        const context = windows.contextForWebContents(win.webContents.id);
        if (context?.role === "game") {
          logEvent(
            { k: "ipc.rejected", channel: name, code: errorCode(error) },
            windows.requireDiagnosticOwnerForWindow(win),
          );
        }
        throw error;
      }
      return def.run(win, input);
    });
  }
}

export function registerNamedChannelDefinitions<Key extends string>(
  windows: WindowRegistry,
  channels: Readonly<Record<Key, string>>,
  handlers: Readonly<Partial<Record<Key, AnyChannelDef>>>,
): void {
  for (const [key, definition] of Object.entries(handlers) as [Key, AnyChannelDef][]) {
    const def = definition as ChannelDef<unknown, unknown>;
    ipcMain.handle(channels[key], async (event, ...args: unknown[]) => {
      const win = assertSender(windows, event, def.role);
      const input = def.parse(args);
      return def.run(win, input);
    });
  }
}

export function sendIfLive(
  win: BrowserWindow,
  channelName: string,
  value: unknown,
): boolean {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  try {
    win.webContents.send(channelName, value);
    return true;
  } catch {
    return false;
  }
}

function assertSender(
  registry: WindowRegistry,
  event: Electron.IpcMainInvokeEvent,
  role: SenderRole,
): BrowserWindow {
  const win = registry.windowForWebContents(event.sender.id);
  if (!win) throw new AllowlistError("unowned ipc sender");
  const mainFrame = !!event.senderFrame && event.senderFrame === event.sender.mainFrame;
  const refusal = senderRefusal(role, registry.contextForWebContents(event.sender.id), mainFrame, event.senderFrame?.url ?? "");
  if (refusal) throw new AllowlistError(refusal);
  return win;
}
