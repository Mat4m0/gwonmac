import { BrowserWindow, ipcMain } from "electron";
import {
  IPC,
  type ControlInvokeChannel,
} from "../shared/contracts.js";
import { AllowlistError, errorCode, ValidationError } from "../shared/errors.js";
import {
  normalizeProfileLabel,
  parseProfileId,
  type ProfileId,
} from "./core/profiles.js";
import { isCanonicalControlRendererUrl } from "./core/renderer-trust.js";
import { logEvent } from "./diagnostics.js";
import type { ProfileManager } from "./profile-manager.js";
import type { WindowRegistry } from "./window-registry.js";

interface ControlIpcContext {
  readonly windows: WindowRegistry;
  readonly profiles: ProfileManager;
  readonly clearDownloadedData: () => Promise<boolean>;
}

type Parser<In> = (args: readonly unknown[]) => In;
type Run<In> = (input: In) => unknown | Promise<unknown>;

interface ChannelDef<In> {
  readonly parse: Parser<In>;
  readonly run: Run<In>;
}

interface AnyChannelDef {
  readonly parse: Parser<unknown>;
  readonly run: Run<never>;
}

function channel<In>(parse: Parser<In>, run: Run<In>): ChannelDef<In> {
  return { parse, run };
}

function exact(args: readonly unknown[], count: number): void {
  if (args.length !== count) {
    throw new ValidationError(`expected ${count} IPC argument(s)`);
  }
}

const nothing: Parser<void> = (args) => exact(args, 0);
const id: Parser<ProfileId> = (args) => {
  exact(args, 1);
  return parseProfileId(args[0]);
};
const label: Parser<string> = (args) => {
  exact(args, 1);
  return normalizeProfileLabel(args[0]);
};
const idAndLabel: Parser<{ id: ProfileId; label: string }> = (args) => {
  exact(args, 2);
  return {
    id: parseProfileId(args[0]),
    label: normalizeProfileLabel(args[1]),
  };
};

function assertControlSender(
  event: Electron.IpcMainInvokeEvent,
  windows: WindowRegistry,
): void {
  const win = BrowserWindow.fromWebContents(event.sender);
  const context = windows.contextFor(event.sender);
  if (
    !win
    || context?.kind !== "control"
    || context.window !== win
    || !event.senderFrame
    || event.senderFrame !== event.sender.mainFrame
    || !isCanonicalControlRendererUrl(event.senderFrame.url)
  ) {
    throw new AllowlistError("unowned control ipc sender");
  }
}

export function registerControlIpcHandlers(ctx: ControlIpcContext): void {
  const handlers = {
    profilesList: channel(nothing, () => ctx.profiles.list()),
    profilesCreate: channel(label, (value) => ctx.profiles.create(value)),
    profilesRename: channel(
      idAndLabel,
      (value) => ctx.profiles.rename(value.id, value.label),
    ),
    profilesLaunch: channel(id, (value) => ctx.profiles.launch(value)),
    profilesClose: channel(id, (value) => ctx.profiles.close(value)),
    profilesForgetLogin: channel(
      id,
      (value) => ctx.profiles.forgetSavedLogin(value),
    ),
    profilesResetStorage: channel(
      id,
      (value) => ctx.profiles.resetSavedFiles(value),
    ),
    profilesTrash: channel(id, (value) => ctx.profiles.moveToTrash(value)),
    controlCacheClear: channel(
      nothing,
      () => ctx.clearDownloadedData(),
    ),
  } satisfies Record<ControlInvokeChannel, AnyChannelDef>;

  for (const [key, definition] of Object.entries(handlers)) {
    const name = key as ControlInvokeChannel;
    const def = definition as ChannelDef<unknown>;
    ipcMain.handle(IPC[name], async (event, ...args: unknown[]) => {
      assertControlSender(event, ctx.windows);
      let input: unknown;
      try {
        input = def.parse(args);
      } catch (error) {
        logEvent({ k: "ipc.rejected", channel: name, code: errorCode(error) });
        throw error;
      }
      return def.run(input);
    });
  }
}
