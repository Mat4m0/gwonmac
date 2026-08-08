/**
 * Every native capability the renderer may ask for, and the boundary that
 * decides whether it may have it.
 *
 * A channel exists only as a parser paired with a handler, checked against
 * `InvokeChannel`, so a channel with no handler and a handler with no channel
 * are both build failures and nothing can be registered that takes its
 * arguments unvalidated. The sender is re-checked on every call — the owned
 * window, its main frame, the canonical renderer URL — because a page that
 * navigated away is no longer the renderer the capability was granted to.
 *
 * Transport, not policy. What a socket, a secret, a setting or a chunk means is
 * decided behind these handlers; this file validates arguments, names the
 * subsystem that answers, and returns codes rather than inventing prose.
 */
import { BrowserWindow, clipboard, dialog, ipcMain, shell, app } from "electron";
import { statfs, writeFile } from "node:fs/promises";
import type {
  AppSettings,
  AppSettingsPatch,
  AppUpdateState,
  CacheInfo,
  ClientHealthToken,
  ClientSession,
  DownloadProgress,
  ExternalLinkKind,
  FullDownloadOutcome,
  GraphicsDiagnostics,
  InvokeChannel,
  RevealKind,
  SocketEvent,
  SteamRefusalReason,
  SteamTokenResult,
  StoredCredentials,
} from "../shared/contracts.js";
import type {
  RendererFrameBatch,
  RendererMetrics,
  RendererMilestone,
  RendererMilestoneFields,
  WasmAbortReasonKind,
} from "../shared/diagnostics.js";
import {
  isRendererFrameBatch,
  isRendererMetrics,
  RENDERER_MILESTONES,
  WASM_ABORT_REASON_KINDS,
} from "../shared/diagnostics.js";
import { EXTERNAL_URLS, IPC } from "../shared/contracts.js";
import { isDigest } from "../shared/digest.js";
import { AllowlistError, errorCode, ValidationError } from "../shared/errors.js";
import { parseCredentials, type CredentialsStore } from "./core/credentials.js";
import {
  loadBuildLibrary,
  parseBuildLibrary,
  saveBuildLibrary,
} from "./core/build-library.js";
import { resolveDns } from "./core/dns.js";
import { exportTemplates, parseExportEntries } from "./template-export.js";
import {
  MAX_TOKEN_LENGTH,
  SteamSessionCoordinator,
  type SteamSessionStore,
  steamTokenOutcome,
} from "./core/steam-session.js";
import type {
  SteamAcquireEvent,
  SteamAcquireResult,
} from "./steam-acquire.js";
import { parseSettingsPatch } from "./core/settings.js";
import type { SocketManager } from "./core/sockets.js";
import { buildSnapshotMetadata } from "./core/snapshot.js";
import { FREE_MARGIN, type ChunkStore } from "./core/chunk-store.js";
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
import { isRendererFingerprint } from "./diagnostics/schema.js";
import { gamePaths } from "./paths.js";
import { isCanonicalRendererUrl } from "./core/renderer-trust.js";
import { MAX_QUEUED_BYTES_PER_SOCKET } from "./core/sockets.js";
import { isQuitting } from "./lifecycle.js";
import { getMainWindow, resetWindowState } from "./window.js";
import { resetGameInput } from "./renderer-commands.js";

export interface IpcContext {
  sockets: SocketManager;
  credentialsStore: CredentialsStore;
  steamSessionStore: SteamSessionStore;
  getProgress: () => DownloadProgress;
  getChunkStore: () => ChunkStore | null;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  resetSettings: () => Promise<AppSettings>;
  downloadFullGame: () => Promise<FullDownloadOutcome>;
  stopFullDownload: () => void;
  confirmClientHealthy: (token: ClientHealthToken) => Promise<void>;
  retryClient: () => Promise<void>;
  getAppUpdateState: () => AppUpdateState;
  checkAppUpdates: () => Promise<void>;
  restartAndInstallUpdate: (win: BrowserWindow) => Promise<void>;
  getClientSession: () => ClientSession;
  exportProblemReport: (win: BrowserWindow) => Promise<void>;
  acquireSteamToken: (
    parent: BrowserWindow,
    record: (event: SteamAcquireEvent) => void,
  ) => Promise<SteamAcquireResult>;
}

type SteamInvokeChannel = "steamToken" | "steamStore" | "steamClear";

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

const asSilentFlag = one((value: unknown): boolean => {
  if (typeof value !== "boolean") throw new ValidationError("silent must be a boolean");
  return value;
});

/**
 * The client's storeback. An empty or wrong-shaped token is *not* refused here:
 * `refreshSteamExpiry` ignores anything that is not the token already held, and
 * ignoring is the documented outcome rather than an error the client has
 * to handle. Only genuinely malformed arguments are rejected.
 */
const asSteamStoreback: Parser<{ token: string; expiry: number | null }> = (args) => {
  exact(args, 2);
  const [token, expiry] = args;
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    throw new ValidationError("steam token must be a string");
  }
  if (expiry !== null && (typeof expiry !== "number" || !Number.isFinite(expiry))) {
    throw new ValidationError("steam token expiry must be a finite number or null");
  }
  return { token, expiry };
};

const asRevealKind = one((value: unknown): RevealKind => {
  if (value !== "gameData") {
    throw new ValidationError("invalid reveal kind");
  }
  return value;
});

// Far above any text a game field holds, low enough that a renderer gone
// wrong cannot stuff megabytes into the OS pasteboard.
const CLIPBOARD_TEXT_CEILING = 64 * 1024;

const asClipboardText = one((value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CLIPBOARD_TEXT_CEILING
  ) {
    throw new ValidationError("invalid clipboard text");
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

/** A byte count as the renderer reports one: a non-negative safe integer. */
const isByteCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const asMilestone: Parser<ParsedMilestone> = (args) => {
  exact(args, 3);
  const [name, rendererTimestampUs, fields] = args;
  if (
    typeof name !== "string" ||
    !RENDERER_MILESTONES.includes(name as RendererMilestone) ||
    typeof rendererTimestampUs !== "number" ||
    !Number.isFinite(rendererTimestampUs) ||
    rendererTimestampUs < 0 ||
    rendererTimestampUs > Number.MAX_SAFE_INTEGER
  ) {
    throw new ValidationError("invalid renderer milestone");
  }
  const record = fields as Record<string, unknown> | undefined;
  const recordIsObject =
    record !== undefined
    && record !== null
    && typeof record === "object"
    && !Array.isArray(record);
  let milestoneFields: RendererMilestoneFields | undefined;
  if (name === "build.info") {
    const valid =
      recordIsObject
      && Object.keys(record).length === 2
      && (typeof record.programId === "string" || typeof record.programId === "number")
      && (typeof record.buildId === "string" || typeof record.buildId === "number")
      && [record.programId, record.buildId].every(
        (value) =>
          (typeof value === "string" && value.length <= 128) ||
          (typeof value === "number" && Number.isSafeInteger(value) && value >= 0),
      );
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      programId: record.programId as string | number,
      buildId: record.buildId as string | number,
    };
  } else if (name === "wasm.abort") {
    const valid =
      recordIsObject
      && Object.keys(record).length === 3
      && typeof record.reasonKind === "string"
      && (WASM_ABORT_REASON_KINDS as readonly string[]).includes(record.reasonKind)
      && isRendererFingerprint(record.fingerprint)
      && isByteCount(record.heapBytes);
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      reasonKind: record.reasonKind as WasmAbortReasonKind,
      fingerprint: record.fingerprint as string,
      heapBytes: record.heapBytes as number,
    };
  } else if (name === "wasm.exit") {
    const valid =
      recordIsObject
      && Object.keys(record).length === 2
      && typeof record.code === "number"
      && Number.isSafeInteger(record.code)
      && isByteCount(record.heapBytes);
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      code: record.code as number,
      heapBytes: record.heapBytes as number,
    };
  } else if (name === "enhancement.installed") {
    const valid =
      recordIsObject
      && Object.keys(record).length === 3
      && typeof record.companionAbi === "number"
      && Number.isSafeInteger(record.companionAbi)
      && record.companionAbi >= 0
      && typeof record.installation === "number"
      && Number.isSafeInteger(record.installation)
      && record.installation >= 1
      && typeof record.capabilityProfile === "string"
      && record.capabilityProfile.length <= 32;
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = {
      companionAbi: record.companionAbi as number,
      installation: record.installation as number,
      capabilityProfile: record.capabilityProfile as string,
    };
  } else if (name === "enhancement.uninstalled") {
    const valid =
      recordIsObject
      && Object.keys(record).length === 1
      && typeof record.installation === "number"
      && Number.isSafeInteger(record.installation)
      && record.installation >= 1;
    if (!valid) throw new ValidationError("invalid renderer milestone");
    milestoneFields = { installation: record.installation as number };
  } else if (fields !== undefined) {
    throw new ValidationError("invalid renderer milestone");
  }
  return {
    name: name as RendererMilestone,
    rendererTimestampUs,
    fields: milestoneFields,
  };
};

async function chunkStoreInfo(
  store: ChunkStore | null,
  volumeDir: string,
): Promise<CacheInfo> {
  // Advisory only — the download preflight re-measures and enforces. An
  // unreadable volume therefore answers "could not be measured" rather than
  // blocking the Full Game card on a measurement error.
  let freeBytes = -1;
  try {
    const fsStat = await statfs(store?.chunksDir ?? volumeDir);
    freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
  } catch {
    // Keep the "could not be measured" answer.
  }
  if (!store) {
    return {
      bytes: 0,
      chunks: 0,
      totalBytes: 0,
      totalChunks: 0,
      freeBytes,
      fullDownloadShortfall: 0,
    };
  }
  const resident = await store.residentIndices();
  const bytes = resident.reduce(
    (total, index) => total + store.chunkByteLength(index),
    0,
  );
  // Remaining bytes rather than the preflight's hash-deduplicated need: close
  // enough for a card, and always the pessimistic side of the two.
  const remaining = Math.max(0, store.size - bytes);
  const fullDownloadShortfall =
    remaining > 0 && freeBytes >= 0
      ? Math.max(0, remaining + FREE_MARGIN - freeBytes)
      : 0;
  return {
    bytes,
    chunks: resident.length,
    totalBytes: store.size,
    totalChunks: store.hashes.length,
    freeBytes,
    fullDownloadShortfall,
  };
}

export function registerIpcHandlers(ctx: IpcContext): {
  drainSecrets(): Promise<void>;
} {
  const paths = gamePaths();
  const credentials = ctx.credentialsStore;
  const secretOperations = new Set<Promise<unknown>>();
  const secretOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    if (isQuitting()) {
      return Promise.reject(new ValidationError("application is quitting"));
    }
    const pending = operation();
    secretOperations.add(pending);
    void pending.then(
      () => secretOperations.delete(pending),
      () => secretOperations.delete(pending),
    );
    return pending;
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

    buildLibraryGet: channel(nothing, async () => {
      let recovered = false;
      const library = await loadBuildLibrary(paths.buildLibrary, () => {
        recovered = true;
      });
      return { library, recovered };
    }),

    buildLibrarySet: channel(one(parseBuildLibrary), async (_win, library) => {
      await saveBuildLibrary(paths.buildLibrary, library);
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
        const saved = await ctx.updateSettings(patch);
        if (previous.dataStrategy !== saved.dataStrategy) {
          logEvent({ k: "launcher.strategyChanged",
            strategy: saved.dataStrategy ?? "unselected",
          });
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
        const { response } = await dialog.showMessageBox(win, {
          type: "warning",
          buttons: ["Reset Launcher Settings", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          message: "Reset launcher settings?",
          detail: "Display, controls, window size and position, and advanced settings return to their defaults. The download choice will appear next launch. Downloaded game data and your saved login stay untouched.",
        });
        if (response !== 0) return null;
        const settings = await ctx.resetSettings();
        try {
          await resetWindowState(win);
        } catch {
          // The settings file is already durably reset. Window geometry is a
          // separate document, so its failure must not turn that committed
          // result into a false "settings reset failed" answer.
          logEvent({ k: "window.stateResetFailed" });
        }
        logEvent({ k: "settings.reset" });
        return settings;
      } catch (error) {
        logEvent({ k: "settings.resetFailed", code: errorCode(error) });
        throw error;
      }
    }),

    credentialsLoad: channel(nothing, async () => {
      try {
        return await secretOperation(() => credentials.load());
      } catch (error) {
        logEvent({ k: "credentials.loadFailed", code: errorCode(error) });
        throw error;
      }
    }),

    // The store checks the same rule again on its own file; `parseCredentials`
    // is that rule, so the boundary is validated without a second opinion.
    credentialsSave: channel(
      one(parseCredentials),
      async (_win, value: StoredCredentials) => {
        try {
          await secretOperation(() => credentials.save(value));
        } catch (error) {
          logEvent({ k: "credentials.saveFailed", code: errorCode(error) });
          throw error;
        }
      },
    ),

    credentialsClear: channel(nothing, async () => {
      try {
        await secretOperation(() => credentials.clear());
      } catch (error) {
        logEvent({ k: "credentials.clearFailed", code: errorCode(error) });
        throw error;
      }
    }),

    cacheInfo: channel(nothing, async () => {
      try {
        return await chunkStoreInfo(ctx.getChunkStore(), paths.userData);
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
        logEvent({ k: "cache.clearRequested" });
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

    diagnosticsExportReport: channel(nothing, async (win) => {
      await ctx.exportProblemReport(win);
    }),

    appOpenExternal: channel(asExternalLinkKind, async (_win, kind) => {
      await shell.openExternal(EXTERNAL_URLS[kind]);
    }),

    // The renderer names an intent; only main knows the path, and no path is
    // answered back.
    appRevealPath: channel(asRevealKind, (_win, kind) => {
      if (kind === "gameData") shell.showItemInFolder(paths.game);
    }),

    appRequestQuit: channel(nothing, () => {
      app.quit();
    }),

    clipboardWriteText: channel(asClipboardText, (_win, text) => {
      clipboard.writeText(text);
    }),

    // Truncated rather than refused: a player who copied something large before
    // reaching for Import from Clipboard should see "no build templates in
    // that", not a failure about a size they never chose.
    clipboardReadText: channel(nothing, () =>
      clipboard.readText().slice(0, CLIPBOARD_TEXT_CEILING),
    ),

    templatesExport: channel(one(parseExportEntries), async (win, entries) => {
      const result = await exportTemplates(win, entries);
      if (result.status === "written") {
        logEvent({ k: "templates.exported", count: result.count });
      } else if (result.status === "failed") {
        logEvent({ k: "templates.exportFailed", code: result.errorCode });
      }
      return result;
    }),

    clientRetry: channel(nothing, () => ctx.retryClient()),

    clientHealthy: channel(asClientHealthToken, (_win, token) =>
      ctx.confirmClientHealthy(token),
    ),

    clientSession: channel(nothing, () => ctx.getClientSession()),

    appUpdatesGetState: channel(nothing, () => ctx.getAppUpdateState()),
    appUpdatesCheck: channel(nothing, () => ctx.checkAppUpdates()),
    appUpdatesRestartAndInstall: channel(
      nothing,
      (win) => ctx.restartAndInstallUpdate(win),
    ),
  } satisfies Record<Exclude<InvokeChannel, SteamInvokeChannel>, AnyChannelDef>;

  registerChannelDefinitions(handlers);
  const steamSettled = registerSteamIpcHandlers(
    ctx.acquireSteamToken,
    ctx.steamSessionStore,
  );
  return {
    async drainSecrets() {
      await steamSettled();
      while (secretOperations.size > 0) {
        await Promise.allSettled([...secretOperations]);
      }
    },
  };
}

function registerChannelDefinitions(
  handlers: Partial<Record<InvokeChannel, AnyChannelDef>>,
): void {
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

export function registerSteamIpcHandlers(
  acquireSteamToken: IpcContext["acquireSteamToken"],
  store: SteamSessionStore,
): () => Promise<void> {
  const steam = new SteamSessionCoordinator(store);

  const runSteamSignIn = async (
    win: BrowserWindow,
  ): Promise<{ token: string | null; refusal?: SteamRefusalReason }> => {
    const result = await acquireSteamToken(win, (event) => {
      if (event.k === "opened") logEvent({ k: "steam.signInOpened" });
      if (event.k === "blocked") {
        logEvent({ k: "steam.signInBlocked", what: event.what });
      }
      if (event.k === "settled") {
        logEvent({ k: "steam.signInResult", outcome: event.outcome });
      }
    });
    // The reason survives to the renderer: a player whose sign-in failed used
    // to land back on the login screen with no explanation at all.
    return result.ok
      ? { token: result.token }
      : { token: null, refusal: result.reason };
  };

  const handlers = {
    // The seam that may open a Steam window — and only for a non-silent
    // request. It answers `null` rather than throwing, because the client
    // rebuilds its own login screen from a refused credential and a rejection
    // here would only turn "no token" into a launch failure.
    steamToken: channel(asSilentFlag, async (win, silent) => {
      if (isQuitting()) throw new ValidationError("application is quitting");
      const resolution = await steam.resolve({
        silent,
        acquire: () => runSteamSignIn(win),
      });
      for (const note of resolution.notes) {
        if (note.note === "loadFailed") {
          logEvent({ k: "steam.tokenLoadFailed", code: note.code });
        }
        if (note.note === "expired") logEvent({ k: "steam.tokenExpired" });
        if (note.note === "storeFailed") {
          logEvent({ k: "steam.tokenStoreFailed", code: note.code });
        }
        if (note.note === "acquireFailed") {
          logEvent({ k: "steam.signInResult", outcome: "failed" });
        }
      }
      logEvent({ k: "steam.tokenRequested",
        outcome: steamTokenOutcome(resolution),
        silent,
      });
      return {
        token: resolution.token,
        ...(resolution.refusal ? { reason: resolution.refusal } : {}),
      } satisfies SteamTokenResult;
    }),

    steamStore: channel(asSteamStoreback, async (_win, { token, expiry }) => {
      if (isQuitting()) throw new ValidationError("application is quitting");
      const outcome = await steam.refresh(token, expiry);
      logEvent({ k: "steam.storeback", outcome });
    }),

    steamClear: channel(nothing, async () => {
      if (isQuitting()) throw new ValidationError("application is quitting");
      try {
        await steam.clear();
        logEvent({ k: "steam.tokenCleared" });
      } catch (error) {
        logEvent({ k: "steam.tokenClearFailed", code: errorCode(error) });
        throw error;
      }
    }),
  } satisfies Record<SteamInvokeChannel, AnyChannelDef>;

  registerChannelDefinitions(handlers);
  return () => steam.settled();
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
