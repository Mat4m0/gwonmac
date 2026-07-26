import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  app,
  safeStorage,
} from "electron";
import { writeFile } from "node:fs/promises";
import type {
  AppSettings,
  AppSettingsPatch,
  CacheInfo,
  ClientSession,
  DownloadProgress,
  ExternalLinkKind,
  FullDownloadOutcome,
  GraphicsDiagnostics,
  InvokeChannel,
  ReleaseNotice,
  SocketEvent,
  StoredCredentials,
} from "../shared/contracts.js";
import type {
  RendererFrameBatch,
  RendererMetrics,
  RendererMilestone,
  RendererMilestoneFields,
} from "../shared/diagnostics.js";
import {
  isRendererFrameBatch,
  isRendererMetrics,
  RENDERER_MILESTONES,
} from "../shared/diagnostics.js";
import { EXTERNAL_URLS, IPC } from "../shared/contracts.js";
import { AllowlistError, errorCode, ValidationError } from "../shared/errors.js";
import { CredentialsStore, parseCredentials } from "./core/credentials.js";
import { resolveDns } from "./core/dns.js";
import { parseSettingsPatch } from "./core/settings.js";
import type { SocketManager } from "./core/sockets.js";
import { buildSnapshotMetadata } from "./core/snapshot.js";
import type { ChunkStore } from "./core/chunk-store.js";
import {
  count,
  diagnosticSummary,
  diagnosticTimestampUs,
  log,
  logEvent,
  recordGraphics,
  recordRendererMetrics,
  recordRendererFrames,
  recordRendererMilestone,
  recordClockOffset,
  span,
} from "./diagnostics.js";
import { gamePaths } from "./paths.js";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";
import { toolboxSelectionChanged } from "./toolbox-policy.js";
import { MAX_QUEUED_BYTES_PER_SOCKET } from "./core/sockets.js";
import { getMainWindow, resetGameInput, resetWindowState } from "./window.js";

export interface IpcContext {
  sockets: SocketManager;
  getProgress: () => DownloadProgress;
  getChunkStore: () => ChunkStore | null;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  resetSettings: () => Promise<AppSettings>;
  downloadFullGame: () => Promise<FullDownloadOutcome>;
  stopFullDownload: () => void;
  confirmClientHealthy: () => Promise<void>;
  retryClient: () => Promise<void>;
  checkReleaseNotice: () => Promise<ReleaseNotice>;
  getClientSession: () => ClientSession;
}

function assertSender(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== getMainWindow()) {
    throw new AllowlistError("unowned ipc sender");
  }
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new AllowlistError("ipc sender is not the main frame");
  }
  if (!isCanonicalRendererUrl(event.senderFrame.url)) {
    throw new AllowlistError("invalid ipc origin");
  }
  return win;
}

function toWireSocketEvent(event: SocketEvent): SocketEvent {
  if (event.type !== "data") return event;
  // Structured clone requires a plain ArrayBuffer-backed view.
  return {
    type: "data",
    socketId: event.socketId,
    data: Uint8Array.from(event.data),
  };
}

function sendIfLive(win: BrowserWindow, channel: string, value: unknown): boolean {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
  win.webContents.send(channel, value);
  return true;
}

/**
 * Turns the raw `invoke` arguments into the handler's input, or throws. One per
 * channel, and no channel can be registered without one.
 */
type Parser<In> = (args: readonly unknown[]) => In;
type Run<In, Out> = (win: BrowserWindow, input: In) => Out | Promise<Out>;

interface ChannelDef<In, Out> {
  readonly parse: Parser<In>;
  readonly run: Run<In, Out>;
}

/**
 * A definition with its input type erased, for the `satisfies` constraint.
 * `ChannelDef` is invariant in `In` — `In` is the return of `parse` and a
 * parameter of `run` — so the erasure has to widen each side in its own
 * direction: `parse` to `unknown`, `run` to `never`. That accepts every
 * `channel()` result without an `any` anywhere.
 */
interface AnyChannelDef {
  readonly parse: Parser<unknown>;
  readonly run: Run<never, unknown>;
}

/** You cannot construct a channel without a parser. That is the point. */
function channel<In, Out>(
  parse: Parser<In>,
  run: Run<In, Out>,
): ChannelDef<In, Out> {
  return { parse, run };
}

/** For the channels that carry nothing. Still a parser, still explicit. */
const nothing: Parser<void> = () => undefined;

/**
 * The two properties the registry exists to give, asserted as type errors so
 * they run inside every `pnpm typecheck` — no new test file, runner or spawned
 * `tsc`. Both were executed in both directions: delete a directive and `tsc`
 * reports the error again; repair the defect it describes and `tsc` reports
 * `TS2578: Unused '@ts-expect-error' directive` instead.
 */
// @ts-expect-error a set of handlers missing a channel is not a registry.
const _channelWithNoHandlerFailsTheBuild: Record<InvokeChannel, AnyChannelDef> =
  {} as Omit<Record<InvokeChannel, AnyChannelDef>, "clientSession">;
// @ts-expect-error `channel()` takes a parser; there is no unvalidated overload.
const _handlerWithNoParserFailsTheBuild = channel(() => undefined);

/** Lifts a single-value validator into a parser over the argument list. */
const one =
  <In>(parse: (value: unknown) => In): Parser<In> =>
  (args) =>
    parse(args[0]);

const asString = (what: string) =>
  one((value: unknown): string => {
    if (typeof value !== "string") throw new ValidationError(`${what} must be a string`);
    return value;
  });

const asSocketId = one((value: unknown): number => {
  if (!Number.isInteger(value)) throw new ValidationError("socketId must be an integer");
  return value as number;
});

const asFiniteNumber = (what: string) =>
  one((value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ValidationError(what);
    }
    return value;
  });

const asSocketPayload: Parser<{ socketId: number; bytes: Uint8Array }> = (args) => {
  const socketId = asSocketId(args);
  const data = args[1];
  if (!(data instanceof Uint8Array) && !ArrayBuffer.isView(data)) {
    throw new ValidationError("data must be a Uint8Array");
  }
  if (data.byteLength > MAX_QUEUED_BYTES_PER_SOCKET) {
    throw new ValidationError(
      `socket payload exceeds ${MAX_QUEUED_BYTES_PER_SOCKET} bytes`,
    );
  }
  return {
    socketId,
    bytes:
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
};

const asClockResult: Parser<{ offsetUs: number; rttUs: number }> = (args) => {
  const [offsetUs, rttUs] = args;
  if (
    typeof offsetUs !== "number" ||
    !Number.isFinite(offsetUs) ||
    typeof rttUs !== "number" ||
    !Number.isFinite(rttUs) ||
    Math.abs(offsetUs) > Number.MAX_SAFE_INTEGER ||
    rttUs < 0 ||
    rttUs > 60_000_000
  ) {
    throw new ValidationError("invalid clock synchronization result");
  }
  return { offsetUs, rttUs };
};

const asGraphics = one((value: unknown): GraphicsDiagnostics => {
  if (!isGraphicsDiagnostics(value)) {
    throw new ValidationError("invalid graphics diagnostics");
  }
  return value;
});

const asRendererMetrics = one((value: unknown): RendererMetrics => {
  if (!isRendererMetrics(value)) throw new ValidationError("invalid renderer diagnostics");
  return value;
});

const asRendererFrames = one((value: unknown): RendererFrameBatch => {
  if (!isRendererFrameBatch(value)) {
    throw new ValidationError("invalid renderer frame batch");
  }
  return value;
});

const asExternalLinkKind = one((value: unknown): ExternalLinkKind => {
  if (
    value !== "github" &&
    value !== "discord" &&
    value !== "donate" &&
    value !== "releases" &&
    value !== "store"
  ) {
    throw new ValidationError("invalid external link kind");
  }
  return value;
});

interface ParsedMilestone {
  name: RendererMilestone;
  rendererTimestampUs: number;
  fields: RendererMilestoneFields | undefined;
}

const asMilestone: Parser<ParsedMilestone> = (args) => {
  const [name, rendererTimestampUs, fields] = args;
  const record = fields as Record<string, unknown> | undefined;
  const milestoneFields =
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    (typeof record.programId === "string" || typeof record.programId === "number") &&
    (typeof record.buildId === "string" || typeof record.buildId === "number")
      ? {
          programId: record.programId as string | number,
          buildId: record.buildId as string | number,
        }
      : undefined;
  if (
    typeof name !== "string" ||
    !RENDERER_MILESTONES.includes(name as RendererMilestone) ||
    typeof rendererTimestampUs !== "number" ||
    !Number.isFinite(rendererTimestampUs) ||
    rendererTimestampUs < 0 ||
    rendererTimestampUs > Number.MAX_SAFE_INTEGER ||
    (name === "build.info" && !milestoneFields) ||
    (name !== "build.info" && fields !== undefined) ||
    (milestoneFields &&
      [milestoneFields.programId, milestoneFields.buildId].some(
        (value) =>
          (typeof value === "string" && value.length > 128) ||
          (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)),
      ))
  ) {
    throw new ValidationError("invalid renderer milestone");
  }
  return {
    name: name as RendererMilestone,
    rendererTimestampUs,
    fields: milestoneFields,
  };
};

/**
 * Ask before restarting to change which Toolbox tools this launch serves. The
 * module is chosen once, before the renderer exists, so a relaunch is the only
 * way a tool change can reach the session — and a relaunch closes any game in
 * progress, which is why it is gated exactly like the other two restarts here.
 */
async function confirmToolboxRestart(win: BrowserWindow): Promise<boolean> {
  await resetGameInput(win);
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Restart Now", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Restart to apply this setting?",
    detail:
      "This setting is chosen once when the app starts, so it takes effect after a restart. Any game in progress closes. Downloaded game data and your saved login stay untouched.",
  });
  return response === 0;
}

async function chunkStoreInfo(store: ChunkStore | null): Promise<CacheInfo> {
  if (!store) return { bytes: 0, chunks: 0, totalBytes: 0, totalChunks: 0 };
  const resident = await store.residentIndices();
  return {
    bytes: resident.reduce(
      (total, index) => total + store.chunkByteLength(index),
      0,
    ),
    chunks: resident.length,
    totalBytes: store.size,
    totalChunks: store.hashes.length,
  };
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const paths = gamePaths();
  const credentials = new CredentialsStore(paths.credentials, safeStorage);

  /**
   * Every channel main answers, with the parser that turns its arguments into
   * the input it takes. Checked against `InvokeChannel`, so a channel with no
   * handler and a handler with no channel are both build failures, and
   * `channel()` cannot be called without a parser.
   */
  const handlers = {
    progressCurrent: channel(nothing, () => ctx.getProgress()),

    snapshotMetadata: channel(nothing, async () => {
      const store = ctx.getChunkStore();
      if (!store) {
        const offlineSize =
          process.env.GW_OFFLINE_SHELL === "1"
            ? Number(process.env.GW_OFFLINE_SNAPSHOT_SIZE ?? 0)
            : 0;
        return buildSnapshotMetadata({
          size:
            Number.isSafeInteger(offlineSize) && offlineSize > 0 ? offlineSize : 0,
          chunkSize: 262144,
          chunkHashes: [],
          residentIndices: [],
        });
      }
      const bits = await store.residentBits();
      return {
        size: store.size,
        chunkSize: store.chunkSize,
        chunkHashes: store.hashes,
        residentBits: bits,
      };
    }),

    dnsResolve: channel(asString("dns name"), async (_win, name) => {
      const lookup = span("dns", "resolve");
      try {
        const address = await resolveDns(name);
        lookup.end({ status: "ok" });
        return address;
      } catch (err) {
        lookup.end({ status: "error", code: errorCode(err) }, "error");
        throw err;
      }
    }),

    socketConnect: channel(asString("destination"), (win, destination) =>
      ctx.sockets.connect(win.webContents.id, destination),
    ),

    socketSend: channel(asSocketPayload, async (win, { socketId, bytes }) => {
      count("socket.ipcReceiveCalls");
      count("socket.ipcPayloadBytes", bytes.byteLength);
      count("socket.ipcBackingBytes", bytes.buffer.byteLength);
      await ctx.sockets.send(socketId, bytes, win.webContents.id);
    }),

    socketClose: channel(asSocketId, async (win, socketId) => {
      await ctx.sockets.close(socketId, win.webContents.id);
    }),

    settingsGet: channel(nothing, async () => {
      try {
        return await ctx.getSettings();
      } catch (error) {
        logEvent({ k: "settings.loadFailed", code: errorCode(error) });
        throw error;
      }
    }),

    settingsSet: channel(one(parseSettingsPatch), async (win, patch) => {
      try {
        const previous = await ctx.getSettings();
        // Changing a Toolbox tool and restarting are one action, so the two
        // surfaces that offer the tools cannot leave a checkbox claiming
        // something the running session is not doing. Cancelling saves
        // nothing: the answer the player sees is the answer on disk.
        const restart = toolboxSelectionChanged(previous, patch);
        if (restart && !(await confirmToolboxRestart(win))) return previous;
        const saved = await ctx.updateSettings(patch);
        if (previous.dataStrategy !== saved.dataStrategy) {
          log("settings", "info", "launcher.strategyChanged", {
            strategy: saved.dataStrategy ?? "unselected",
          });
        }
        if (restart) {
          app.relaunch();
          app.quit();
        }
        return saved;
      } catch (error) {
        logEvent({ k: "settings.saveFailed", code: errorCode(error) });
        throw error;
      }
    }),

    settingsReset: channel(nothing, async (win) => {
      await resetGameInput(win);
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Reset Launcher Settings", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: "Reset launcher settings?",
        detail:
          "Display, controls, window size and position, and advanced settings return to their defaults. The download choice will appear next launch. Downloaded game data and your saved login stay untouched.",
      });
      if (response !== 0) return null;
      try {
        const settings = await ctx.resetSettings();
        await resetWindowState(win);
        log("settings", "info", "settings.reset");
        return settings;
      } catch (error) {
        logEvent({ k: "settings.resetFailed", code: errorCode(error) });
        throw error;
      }
    }),

    credentialsLoad: channel(nothing, async () => {
      try {
        return await credentials.load();
      } catch (error) {
        log("credentials", "error", "credentials.loadFailed");
        throw error;
      }
    }),

    // The store checks the same rule again on its own file; `parseCredentials`
    // is that rule, so the boundary is validated without a second opinion.
    credentialsSave: channel(
      one(parseCredentials),
      async (_win, value: StoredCredentials) => {
        try {
          await credentials.save(value);
        } catch (error) {
          log("credentials", "error", "credentials.saveFailed");
          throw error;
        }
      },
    ),

    credentialsClear: channel(nothing, async () => {
      try {
        await credentials.clear();
      } catch (error) {
        log("credentials", "error", "credentials.clearFailed");
        throw error;
      }
    }),

    cacheInfo: channel(nothing, async () => {
      try {
        return await chunkStoreInfo(ctx.getChunkStore());
      } catch (error) {
        logEvent({ k: "cache.infoFailed", code: errorCode(error) });
        throw error;
      }
    }),

    cacheClear: channel(nothing, async (win) => {
      await resetGameInput(win);
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Clear and Restart", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: "Clear downloaded game data?",
        detail:
          "The app will restart. Client files stay installed, but game data will download again.",
      });
      if (response !== 0) return false;
      try {
        await writeFile(paths.cacheClearRequest, "", { mode: 0o600 });
        log("cache", "info", "cache.clearRequested");
        app.relaunch();
        app.quit();
        return true;
      } catch (error) {
        logEvent({ k: "cache.clearRequestFailed", code: errorCode(error) });
        throw error;
      }
    }),

    cacheDownloadAll: channel(nothing, () => ctx.downloadFullGame()),

    cacheStopDownload: channel(nothing, () => ctx.stopFullDownload()),

    gameStorageReset: channel(nothing, async (win) => {
      await resetGameInput(win);
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Reset and Restart", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: "Reset saved Guild Wars files?",
        detail:
          "This removes local Guild Wars settings, build templates, screenshots, and chat logs. Downloaded game data and your saved login stay untouched.",
      });
      if (response !== 0) return false;
      try {
        await writeFile(paths.gameStorageClearRequest, "", { mode: 0o600 });
        log("filesystem", "warn", "filesystem.resetRequested");
        app.relaunch();
        app.quit();
        return true;
      } catch (error) {
        logEvent({ k: "filesystem.resetFailed", code: errorCode(error) });
        throw error;
      }
    }),

    diagnosticsGraphics: channel(asGraphics, (_win, value) => {
      recordGraphics(value);
    }),

    diagnosticsClockSync: channel(
      asFiniteNumber("invalid renderer clock"),
      () => {
        const mainReceiveUs = diagnosticTimestampUs();
        return { mainReceiveUs, mainSendUs: diagnosticTimestampUs() };
      },
    ),

    diagnosticsClockResult: channel(asClockResult, (_win, { offsetUs, rttUs }) => {
      recordClockOffset(offsetUs, rttUs);
    }),

    diagnosticsRendererMetrics: channel(asRendererMetrics, (_win, value) => {
      recordRendererMetrics(value);
    }),

    diagnosticsRendererFrames: channel(asRendererFrames, async (_win, value) => {
      await recordRendererFrames(value);
    }),

    diagnosticsRendererMilestone: channel(
      asMilestone,
      (_win, { name, rendererTimestampUs, fields }) => {
        recordRendererMilestone(name, rendererTimestampUs, fields);
      },
    ),

    diagnosticsCurrent: channel(nothing, () => diagnosticSummary()),

    appOpenExternal: channel(asExternalLinkKind, async (_win, kind) => {
      await shell.openExternal(EXTERNAL_URLS[kind]);
    }),

    appRequestQuit: channel(nothing, () => {
      app.quit();
    }),

    clientRetry: channel(nothing, () => ctx.retryClient()),

    clientHealthy: channel(nothing, () => ctx.confirmClientHealthy()),

    clientSession: channel(nothing, () => ctx.getClientSession()),

    releaseNoticeCheck: channel(nothing, () => ctx.checkReleaseNotice()),
  } satisfies Record<InvokeChannel, AnyChannelDef>;

  // One registration, uniform and total: `assertSender` first, then the
  // channel's own parser, then its run. The cast is the erasure `satisfies`
  // left behind — `parse` produced exactly what `run` takes when `channel()`
  // typechecked the pair.
  //
  // A refused payload is recorded here rather than by the handler, because the
  // handler is never entered. Two channels used to parse inside their own
  // `try` and log `credentials.saveFailed` / `settings.saveFailed`; one event
  // in the loop keeps that evidence for a bug report and extends it to all
  // thirty, so a "saved login stopped working" export shows the rejection
  // instead of nothing.
  for (const [key, definition] of Object.entries(handlers)) {
    const def = definition as ChannelDef<unknown, unknown>;
    const name = key as InvokeChannel;
    ipcMain.handle(IPC[name], async (event, ...args: unknown[]) => {
      const win = assertSender(event);
      let input: unknown;
      try {
        input = def.parse(args);
      } catch (error) {
        logEvent({ k: "ipc.rejected", channel: name, code: errorCode(error) });
        throw error;
      }
      return def.run(win, input);
    });
  }
}

function isGraphicsDiagnostics(value: unknown): value is GraphicsDiagnostics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userAgent === "string" &&
    typeof record.jspi === "boolean" &&
    typeof record.webglVersion === "string" &&
    typeof record.renderer === "string" &&
    typeof record.vendor === "string" &&
    typeof record.hardwareAcceleration === "boolean" &&
    [
      "canvasWidth",
      "canvasHeight",
      "offscreenWidth",
      "offscreenHeight",
      "drawingBufferWidth",
      "drawingBufferHeight",
      "devicePixelRatio",
      "renderScale",
      "samples",
    ].every(
      (key) => typeof record[key] === "number" && Number.isFinite(record[key]),
    ) &&
    typeof record.antialias === "boolean" &&
    record.userAgent.length <= 2_048 &&
    record.webglVersion.length <= 1_024 &&
    record.renderer.length <= 1_024 &&
    record.vendor.length <= 1_024 &&
    (record.canvasWidth as number) >= 0 &&
    (record.canvasWidth as number) <= 32_768 &&
    (record.canvasHeight as number) >= 0 &&
    (record.canvasHeight as number) <= 32_768 &&
    (record.offscreenWidth as number) >= 0 &&
    (record.offscreenWidth as number) <= 32_768 &&
    (record.offscreenHeight as number) >= 0 &&
    (record.offscreenHeight as number) <= 32_768 &&
    (record.drawingBufferWidth as number) >= 0 &&
    (record.drawingBufferWidth as number) <= 32_768 &&
    (record.drawingBufferHeight as number) >= 0 &&
    (record.drawingBufferHeight as number) <= 32_768 &&
    Number.isInteger(record.samples) &&
    (record.samples as number) >= 0 &&
    (record.samples as number) <= 64 &&
    (record.devicePixelRatio as number) > 0 &&
    (record.devicePixelRatio as number) <= 16 &&
    (record.renderScale === 1 ||
      record.renderScale === 1.5 ||
      record.renderScale === 2)
  );
}

export function emitSocketEvent(ownerId: number, event: SocketEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    if (win.webContents.id === ownerId) {
      sendIfLive(win, IPC.socketEvent, toWireSocketEvent(event));
    }
  }
}
