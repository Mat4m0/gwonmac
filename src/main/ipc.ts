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
  ClientHealthToken,
  ClientSession,
  DownloadProgress,
  ExternalLinkKind,
  FullDownloadOutcome,
  GraphicsDiagnostics,
  GameInvokeChannel,
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
import { DEFAULT_SETTINGS, EXTERNAL_URLS, IPC } from "../shared/contracts.js";
import { isDigest } from "../shared/digest.js";
import { AllowlistError, errorCode, ValidationError } from "../shared/errors.js";
import { CredentialsStore, parseCredentials } from "./core/credentials.js";
import { createCredentialProvider } from "./credential-provider.js";
import { resolveDns } from "./core/dns.js";
import { parseSettingsPatch } from "./core/settings.js";
import type { SocketManager } from "./core/sockets.js";
import { buildSnapshotMetadata } from "./core/snapshot.js";
import type { ChunkStore } from "./core/chunk-store.js";
import {
  count,
  diagnosticSummary,
  diagnosticTimestampUs,
  logEvent,
  recordGraphics,
  recordRendererMetrics,
  recordRendererFrames,
  recordRendererMilestone,
  recordClockOffset,
  startDnsResolveSpan,
} from "./diagnostics.js";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";
import { enhancementSelectionChanged } from "./enhancement-policy.js";
import { MAX_QUEUED_BYTES_PER_SOCKET } from "./core/sockets.js";
import { resetGameInput } from "./window.js";
import type { WindowRegistry } from "./window-registry.js";
import type { ProfileId, ProfileRecord } from "./core/profiles.js";

export interface IpcContext {
  windows: WindowRegistry;
  sockets: SocketManager;
  getProfile: (id: ProfileId) => Promise<ProfileRecord>;
  getProgress: () => DownloadProgress;
  getChunkStore: () => ChunkStore | null;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  resetSettings: () => Promise<AppSettings>;
  resetWindowState: (win: BrowserWindow) => Promise<void>;
  closeGame: (win: BrowserWindow) => Promise<void>;
  downloadFullGame: () => Promise<FullDownloadOutcome>;
  stopFullDownload: () => void;
  confirmClientHealthy: (token: ClientHealthToken) => Promise<void>;
  retryClient: () => Promise<void>;
  checkReleaseNotice: () => Promise<ReleaseNotice>;
  getClientSession: () => ClientSession;
}

function assertSender(
  event: Electron.IpcMainInvokeEvent,
  windows: WindowRegistry,
): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  const context = windows.contextFor(event.sender);
  if (
    !win
    || context?.kind !== "game"
    || context.window !== win
  ) {
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
  try {
    win.webContents.send(channel, value);
    return true;
  } catch {
    // Renderer destruction can race the checks above. Socket callbacks are
    // native and synchronous, so that ordinary teardown must not escape into
    // the process-wide fatal-error handler.
    return false;
  }
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
const exact = (args: readonly unknown[], count: number): void => {
  if (args.length !== count) {
    throw new ValidationError(`expected ${count} IPC argument(s)`);
  }
};

const nothing: Parser<void> = (args) => {
  exact(args, 0);
};

/** Lifts a single-value validator into a parser over the argument list. */
const one =
  <In>(parse: (value: unknown) => In): Parser<In> =>
  (args) => {
    exact(args, 1);
    return parse(args[0]);
  };

const asString = (what: string) =>
  one((value: unknown): string => {
    if (typeof value !== "string") throw new ValidationError(`${what} must be a string`);
    return value;
  });

const parseSocketId = (value: unknown): number => {
  if (!Number.isInteger(value)) throw new ValidationError("socketId must be an integer");
  return value as number;
};
const asSocketId = one(parseSocketId);

const asClientHealthToken = one((value: unknown): ClientHealthToken => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("invalid client health token");
  }
  const token = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(token.generation) ||
    (token.generation as number) <= 0 ||
    !isDigest(token.fingerprint) ||
    Object.keys(token).some(
      (key) => key !== "generation" && key !== "fingerprint",
    )
  ) {
    throw new ValidationError("invalid client health token");
  }
  return {
    generation: token.generation as number,
    fingerprint: token.fingerprint,
  };
});

const asFiniteNumber = (what: string) =>
  one((value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ValidationError(what);
    }
    return value;
  });

const asSocketPayload: Parser<{ socketId: number; bytes: Uint8Array }> = (args) => {
  exact(args, 2);
  const socketId = parseSocketId(args[0]);
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
  exact(args, 2);
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
  exact(args, 3);
  const [name, rendererTimestampUs, fields] = args;
  const record = fields as Record<string, unknown> | undefined;
  const recordIsObject =
    record !== undefined
    && record !== null
    && typeof record === "object"
    && !Array.isArray(record);
  const exactBuildInfoFields =
    recordIsObject
    && Object.keys(record).length === 2
    && Object.hasOwn(record, "programId")
    && Object.hasOwn(record, "buildId");
  const milestoneFields =
    recordIsObject &&
    exactBuildInfoFields &&
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
 * Ask before restarting to change which enhancements this launch serves. The
 * module is chosen once, before the renderer exists, so a relaunch is the only
 * way a tool change can reach the session — and a relaunch closes any game in
 * progress, which is why it is gated exactly like the other two restarts here.
 */
async function confirmEnhancementRestart(win: BrowserWindow): Promise<boolean> {
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
  const credentialProvider = createCredentialProvider(
    process.platform,
    safeStorage,
  );
  const credentials = new Map<ProfileId, CredentialsStore>();
  const profileFor = async (win: BrowserWindow): Promise<ProfileRecord> => {
    const context = ctx.windows.contextForWindow(win);
    if (context?.kind !== "game") {
      throw new AllowlistError("game profile owner disappeared");
    }
    return ctx.getProfile(context.profileId);
  };
  const credentialsFor = async (
    win: BrowserWindow,
  ): Promise<CredentialsStore> => {
    const profile = await profileFor(win);
    let store = credentials.get(profile.id);
    if (!store) {
      store = new CredentialsStore(
        profile.paths.credentials,
        credentialProvider,
      );
      credentials.set(profile.id, store);
    }
    return store;
  };

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
      const lookup = startDnsResolveSpan();
      try {
        const address = await resolveDns(name);
        lookup.end({ status: "ok", code: null });
        return address;
      } catch (err) {
        lookup.end({ status: "error", code: errorCode(err) });
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
        // Changing an enhancement and restarting are one action, so the two
        // surfaces that offer the tools cannot leave a checkbox claiming
        // something the running session is not doing. Cancelling saves
        // nothing: the answer the player sees is the answer on disk.
        const restart = enhancementSelectionChanged(previous, patch);
        if (restart && !(await confirmEnhancementRestart(win))) return previous;
        const saved = await ctx.updateSettings(patch);
        if (previous.dataStrategy !== saved.dataStrategy) {
          logEvent({ k: "launcher.strategyChanged",
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
      try {
        const previous = await ctx.getSettings();
        const restart = enhancementSelectionChanged(previous, DEFAULT_SETTINGS);
        const { response } = await dialog.showMessageBox(win, {
          type: "warning",
          buttons: [
            restart ? "Reset and Restart" : "Reset Launcher Settings",
            "Cancel",
          ],
          defaultId: 1,
          cancelId: 1,
          message: "Reset launcher settings?",
          detail: restart
            ? "Display, controls, window size and position, and advanced settings return to their defaults, then the app restarts to apply the GWonMac Tools settings. Downloaded game data and your saved login stay untouched."
            : "Display, controls, window size and position, and advanced settings return to their defaults. The download choice will appear next launch. Downloaded game data and your saved login stay untouched.",
        });
        if (response !== 0) return null;
        const settings = await ctx.resetSettings();
        try {
          await ctx.resetWindowState(win);
        } catch {
          // The settings file is already durably reset. Window geometry is a
          // separate document, so its failure must not turn that committed
          // result into a false "settings reset failed" answer.
          logEvent({ k: "window.stateResetFailed" });
        }
        logEvent({ k: "settings.reset" });
        if (restart) {
          app.relaunch();
          app.quit();
        }
        return settings;
      } catch (error) {
        logEvent({ k: "settings.resetFailed", code: errorCode(error) });
        throw error;
      }
    }),

    credentialsLoad: channel(nothing, async (win) => {
      try {
        return await (await credentialsFor(win)).load();
      } catch (error) {
        logEvent({ k: "credentials.loadFailed" });
        throw error;
      }
    }),

    // The store checks the same rule again on its own file; `parseCredentials`
    // is that rule, so the boundary is validated without a second opinion.
    credentialsSave: channel(
      one(parseCredentials),
      async (win, value: StoredCredentials) => {
        try {
          await (await credentialsFor(win)).save(value);
        } catch (error) {
          logEvent({ k: "credentials.saveFailed" });
          throw error;
        }
      },
    ),

    credentialsClear: channel(nothing, async (win) => {
      try {
        await (await credentialsFor(win)).clear();
      } catch (error) {
        logEvent({ k: "credentials.clearFailed" });
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
      await dialog.showMessageBox(win, {
        type: "info",
        buttons: ["OK"],
        message: "Close Guild Wars first",
        detail:
          "Downloaded game data is shared by every profile. Clear it from the profile manager when no game is running.",
      });
      return false;
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
        const profile = await profileFor(win);
        await writeFile(profile.paths.gameStorageClearRequest, "", {
          mode: 0o600,
        });
        logEvent({ k: "filesystem.resetRequested" });
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

    diagnosticsClockResult: channel(asClockResult, (win, { offsetUs, rttUs }) => {
      recordClockOffset(win.webContents, offsetUs, rttUs);
    }),

    diagnosticsRendererMetrics: channel(asRendererMetrics, (_win, value) => {
      recordRendererMetrics(value);
    }),

    diagnosticsRendererFrames: channel(asRendererFrames, async (_win, value) => {
      await recordRendererFrames(value);
    }),

    diagnosticsRendererMilestone: channel(
      asMilestone,
      (win, { name, rendererTimestampUs, fields }) => {
        recordRendererMilestone(
          win.webContents,
          name,
          rendererTimestampUs,
          fields,
        );
      },
    ),

    diagnosticsCurrent: channel(nothing, () => diagnosticSummary()),

    appOpenExternal: channel(asExternalLinkKind, async (_win, kind) => {
      await shell.openExternal(EXTERNAL_URLS[kind]);
    }),

    appRequestQuit: channel(nothing, (win) => ctx.closeGame(win)),

    clientRetry: channel(nothing, () => ctx.retryClient()),

    clientHealthy: channel(asClientHealthToken, (_win, token) =>
      ctx.confirmClientHealthy(token),
    ),

    clientSession: channel(nothing, () => ctx.getClientSession()),

    releaseNoticeCheck: channel(nothing, () => ctx.checkReleaseNotice()),
  } satisfies Record<GameInvokeChannel, AnyChannelDef>;

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
    const name = key as GameInvokeChannel;
    ipcMain.handle(IPC[name], async (event, ...args: unknown[]) => {
      const win = assertSender(event, ctx.windows);
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

export function emitSocketEvent(
  windows: WindowRegistry,
  ownerId: number,
  event: SocketEvent,
): void {
  const context = windows.gameWindows().find(
    (candidate) => candidate.window.webContents.id === ownerId,
  );
  if (!context) return;
  sendIfLive(context.window, IPC.socketEvent, toWireSocketEvent(event));
}
