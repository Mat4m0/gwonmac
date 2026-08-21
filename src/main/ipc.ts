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
 * Multi-step feature policy lives behind these handlers. This file validates
 * arguments and either forwards one owner-local capability directly or calls
 * the workflow owner; it returns codes rather than inventing prose.
 */
import { BrowserWindow, clipboard, ipcMain, shell } from "electron";
import { statfs } from "node:fs/promises";
import type {
  AppSettings,
  AppSettingsPatch,
  AccountsSetupRequest,
  AccountProfileCreateRequest,
  AccountProfileUpdateRequest,
  AccountTemplateLibrary,
  AccountsState,
  AppUpdateState,
  CacheInfo,
  ClientHealthToken,
  ClientSession,
  DownloadProgress,
  EnhancementRuntimeFeature,
  ExternalLinkKind,
  FullDownloadOutcome,
  GraphicsDiagnostics,
  InvokeChannel,
  TextEditCommand,
  RevealKind,
  SocketEvent,
  SteamRefusalReason,
  SteamTokenResult,
  StoredCredentials,
  TemplateExportEntry,
} from "../shared/contracts.js";
import { parseProfileId, type ProfileId } from "../shared/multiple-accounts.js";
import {
  parseTravelUserPreferencesUpdate,
  type TravelUserPreferences,
  type TravelUserPreferencesUpdate,
} from "../shared/travel.js";
import { travelDestination } from "../shared/travel-destinations.js";
import type {
  RendererFrameBatch,
  RendererMetrics,
} from "../shared/diagnostics.js";
import {
  isRendererFrameBatch,
  isRendererMetrics,
} from "../shared/diagnostics.js";
import {
  CLIPBOARD_TEXT_CEILING,
  EXTERNAL_URLS,
  IPC,
} from "../shared/contracts.js";
import { ENHANCEMENT_RUNTIME_FEATURES } from "../shared/contracts.js";
import { isDigest } from "../shared/digest.js";
import {
  AllowlistError,
  errorCode,
  NotReadyError,
  ValidationError,
} from "../shared/errors.js";
import { parseCredentials, type CredentialsStore } from "./core/credentials.js";
import { parseBuildLibrary } from "../shared/builds/parse-library.js";
import type { BuildLibrary } from "../shared/builds/library.js";
import {
  isGraphicsDiagnostics,
  parseRendererMilestoneArgs,
  toWireSocketEvent,
} from "./ipc-values.js";
import {
  parseAccountProfileCreate,
  parseAccountProfileUpdate,
  parseAccountsSetup,
  parseProfileIds,
} from "./accounts-ipc-values.js";
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
import { gamePaths } from "./paths.js";
import {
  isAccountsRendererUrl,
  isCanonicalRendererUrl,
} from "./core/renderer-trust.js";
import { MAX_QUEUED_BYTES_PER_SOCKET } from "./core/sockets.js";
import { isQuitting } from "./lifecycle.js";
import { windowRegistry, type WindowRegistry } from "./window-registry.js";
import {
  cancelWindowShortcutCapture,
  captureWindowShortcut,
  updateWindowShortcuts,
} from "./window-shortcuts.js";
import {
  applySettingsChange,
  confirmSettingsReset,
  requestCacheClear,
  requestGameStorageReset,
} from "./settings-actions.js";
import { editGameText } from './game-text-editing.js';

export interface IpcContext {
  sockets: SocketManager;
  windows: WindowRegistry;
  credentialsStoreFor: (win: BrowserWindow) => CredentialsStore;
  steamSessionStoreFor: (win: BrowserWindow) => SteamSessionStore;
  getBuildLibrary: (
    win: BrowserWindow,
  ) => Promise<{ readonly library: BuildLibrary; readonly recovered: boolean }>;
  setBuildLibrary: (win: BrowserWindow, library: BuildLibrary) => Promise<BuildLibrary>;
  gameStorageResetMarkerFor: (win: BrowserWindow) => string;
  getProgress: () => DownloadProgress;
  getChunkStore: () => ChunkStore | null;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  resetSettings: () => Promise<AppSettings>;
  getTravelPreferences: () => Promise<TravelUserPreferences>;
  setTravelPreferences: (update: TravelUserPreferencesUpdate) => Promise<TravelUserPreferences>;
  recordTravelConfirmation: (mapId: number) => Promise<TravelUserPreferences>;
  /** Whether this process started with every certified Tools capability prepared. */
  toolsEnabledAtLaunch: boolean;
  downloadFullGame: () => Promise<FullDownloadOutcome>;
  stopFullDownload: () => void;
  confirmClientHealthy: (token: ClientHealthToken) => Promise<void>;
  retryClient: () => Promise<void>;
  getAppUpdateState: () => AppUpdateState;
  checkAppUpdates: () => Promise<void>;
  restartAndInstallUpdate: (win: BrowserWindow) => Promise<void>;
  getClientSession: () => ClientSession;
  recordClientFeatureFailure: (
    features: readonly EnhancementRuntimeFeature[],
  ) => void;
  acquireSteamToken: (
    parent: BrowserWindow,
    record: (event: SteamAcquireEvent) => void,
  ) => Promise<SteamAcquireResult>;
  getAccountsState: () => AccountsState;
  setupAccounts: (request: AccountsSetupRequest) => Promise<void>;
  openAccounts: (profileIds: readonly ProfileId[]) => Promise<void>;
  createAccount: (request: AccountProfileCreateRequest) => Promise<AccountsState>;
  updateAccount: (request: AccountProfileUpdateRequest) => Promise<AccountsState>;
  archiveAccount: (profileId: ProfileId) => Promise<AccountsState>;
  restoreAccount: (profileId: ProfileId) => Promise<AccountsState>;
  deleteAccount: (
    parent: BrowserWindow,
    profileId: ProfileId,
  ) => Promise<AccountsState>;
  useSingleAccountMode: () => Promise<void>;
  requestQuit: (win: BrowserWindow) => void;
  loadAccountTemplates: (win: BrowserWindow) => Promise<AccountTemplateLibrary | null>;
  saveAccountTemplates: (
    win: BrowserWindow,
    entries: readonly TemplateExportEntry[],
  ) => Promise<void>;
}

type SteamInvokeChannel = "steamToken" | "steamStore" | "steamClear";

function assertSender(
  registry: WindowRegistry,
  event: Electron.IpcMainInvokeEvent,
  role: "game" | "hub" | "any",
): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  const context = registry.contextForWebContents(event.sender.id);
  if (!win || !context || (role !== "any" && context.role !== role)) {
    throw new AllowlistError("unowned ipc sender");
  }
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new AllowlistError("ipc sender is not the main frame");
  }
  const trusted = context.role === "hub"
    ? isAccountsRendererUrl(event.senderFrame.url)
    : isCanonicalRendererUrl(event.senderFrame.url);
  if (!trusted) {
    throw new AllowlistError("invalid ipc origin");
  }
  return win;
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
  readonly role: "game" | "hub" | "any";
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
  readonly role: "game" | "hub" | "any";
}

/** You cannot construct a channel without a parser. That is the point. */
function channel<In, Out>(
  parse: Parser<In>,
  run: Run<In, Out>,
  role: "game" | "hub" | "any" = "game",
): ChannelDef<In, Out> {
  return { parse, run, role };
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

const asEnhancementRuntimeFeatures = one(
  (value: unknown): readonly EnhancementRuntimeFeature[] => {
    if (
      !Array.isArray(value)
      || value.length === 0
      || value.length > ENHANCEMENT_RUNTIME_FEATURES.length
      || value.some((feature) =>
        typeof feature !== "string"
        || !ENHANCEMENT_RUNTIME_FEATURES.includes(
          feature as EnhancementRuntimeFeature,
        ))
      || new Set(value).size !== value.length
    ) throw new ValidationError("invalid enhancement feature failure");
    return value as EnhancementRuntimeFeature[];
  },
);

const asFiniteNumber = (what: string) =>
  one((value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ValidationError(what);
    }
    return value;
  });

const asTravelMapId = one((value: unknown): number => {
  if (!Number.isSafeInteger(value) || travelDestination(Number(value)) === null) {
    throw new ValidationError("invalid Travel destination");
  }
  return Number(value);
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

const asTextEditCommand = one((value: unknown): TextEditCommand => {
  if (value !== "selectAll" && value !== "cut" && value !== "paste") {
    throw new ValidationError("invalid text edit command");
  }
  return value;
});

const asExternalLinkKind = one((value: unknown): ExternalLinkKind => {
  if (
    value !== "github" &&
    value !== "bugReport" &&
    value !== "featureRequest" &&
    value !== "discord" &&
    value !== "donate" &&
    value !== "releases" &&
    value !== "store"
  ) {
    throw new ValidationError("invalid external link kind");
  }
  return value;
});

const asAccountsSetup = one(parseAccountsSetup);
const asAccountProfileCreate = one(parseAccountProfileCreate);
const asAccountProfileUpdate = one(parseAccountProfileUpdate);
const asProfileId = one(parseProfileId);
const asProfileIds = one(parseProfileIds);
const asMilestone = parseRendererMilestoneArgs;

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
        throw new NotReadyError("no active client snapshot is available");
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

    buildLibraryGet: channel(nothing, (win) => ctx.getBuildLibrary(win)),

    buildLibrarySet: channel(one(parseBuildLibrary), (win, library) =>
      ctx.setBuildLibrary(win, library)),

    settingsGet: channel(nothing, async () => {
      try {
        return await ctx.getSettings();
      } catch (error) {
        logEvent({ k: "settings.loadFailed", code: errorCode(error) });
        throw error;
      }
    }),

    settingsSet: channel(one(parseSettingsPatch), async (win, patch) => {
      const saved = await applySettingsChange(
        win,
        patch,
        ctx.toolsEnabledAtLaunch,
        ctx.getSettings,
        ctx.updateSettings,
      );
      updateWindowShortcuts(win, saved.shortcutOverrides);
      return saved;
    }),

    settingsReset: channel(nothing, async (win) => {
      const saved = await confirmSettingsReset(win, ctx.resetSettings);
      if (saved) updateWindowShortcuts(win, saved.shortcutOverrides);
      return saved;
    }),

    travelPreferencesGet: channel(nothing, () => ctx.getTravelPreferences()),
    travelPreferencesSet: channel(one(parseTravelUserPreferencesUpdate), (_win, update) =>
      ctx.setTravelPreferences(update)),
    travelPreferencesRecord: channel(asTravelMapId, (_win, mapId) =>
      ctx.recordTravelConfirmation(mapId)),

    shortcutCapture: channel(nothing, (win) => captureWindowShortcut(win)),
    shortcutCaptureCancel: channel(nothing, (win) => {
      cancelWindowShortcutCapture(win);
    }),

    credentialsLoad: channel(nothing, async (win) => {
      try {
        return await secretOperation(() => ctx.credentialsStoreFor(win).load());
      } catch (error) {
        logEvent({ k: "credentials.loadFailed", code: errorCode(error) });
        throw error;
      }
    }),

    // The store checks the same rule again on its own file; `parseCredentials`
    // is that rule, so the boundary is validated without a second opinion.
    credentialsSave: channel(
      one(parseCredentials),
      async (win, value: StoredCredentials) => {
        try {
          await secretOperation(() => ctx.credentialsStoreFor(win).save(value));
        } catch (error) {
          logEvent({ k: "credentials.saveFailed", code: errorCode(error) });
          throw error;
        }
      },
    ),

    credentialsClear: channel(nothing, async (win) => {
      try {
        await secretOperation(() => ctx.credentialsStoreFor(win).clear());
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

    cacheClear: channel(nothing, (win) =>
      requestCacheClear(win, paths.cacheClearRequest),
    ),

    cacheDownloadAll: channel(nothing, () => ctx.downloadFullGame()),

    cacheStopDownload: channel(nothing, () => ctx.stopFullDownload()),

    gameStorageReset: channel(nothing, (win) =>
      requestGameStorageReset(win, ctx.gameStorageResetMarkerFor(win)),
    ),

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

    // The renderer names an intent; only main knows the path, and no path is
    // answered back.
    appRevealPath: channel(asRevealKind, (_win, kind) => {
      if (kind === "gameData") shell.showItemInFolder(paths.game);
    }),

    appRequestQuit: channel(nothing, (win) => ctx.requestQuit(win)),

    clipboardWriteText: channel(asClipboardText, (_win, text) => {
      clipboard.writeText(text);
    }),

    clipboardEdit: channel(asTextEditCommand, (win, command) => {
      editGameText(win.webContents, command);
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

    clientFeatureFailure: channel(asEnhancementRuntimeFeatures, (_win, features) =>
      ctx.recordClientFeatureFailure(features),
    ),

    appUpdatesGetState: channel(nothing, () => ctx.getAppUpdateState()),
    appUpdatesCheck: channel(nothing, () => ctx.checkAppUpdates()),
    appUpdatesRestartAndInstall: channel(
      nothing,
      (win) => ctx.restartAndInstallUpdate(win),
    ),
    accountsGet: channel(
      nothing,
      () => ctx.getAccountsState(),
      "any",
    ),
    accountsSetup: channel(
      asAccountsSetup,
      (_win, request) => ctx.setupAccounts(request),
    ),
    accountsOpen: channel(
      asProfileIds,
      (_win, profileIds) => ctx.openAccounts(profileIds),
      "hub",
    ),
    accountsCreate: channel(
      asAccountProfileCreate,
      (_win, request) => ctx.createAccount(request),
      "hub",
    ),
    accountsUpdate: channel(
      asAccountProfileUpdate,
      (_win, request) => ctx.updateAccount(request),
      "hub",
    ),
    accountsArchive: channel(
      asProfileId,
      (_win, profileId) => ctx.archiveAccount(profileId),
      "hub",
    ),
    accountsRestore: channel(
      asProfileId,
      (_win, profileId) => ctx.restoreAccount(profileId),
      "hub",
    ),
    accountsDelete: channel(
      asProfileId,
      (win, profileId) => ctx.deleteAccount(win, profileId),
      "hub",
    ),
    accountsUseSingle: channel(
      nothing,
      () => ctx.useSingleAccountMode(),
      "any",
    ),
    accountsTemplatesLoad: channel(
      nothing,
      (win) => ctx.loadAccountTemplates(win),
    ),
    accountsTemplatesSave: channel(
      one(parseExportEntries),
      (win, entries) => ctx.saveAccountTemplates(win, entries),
    ),
  } satisfies Record<Exclude<InvokeChannel, SteamInvokeChannel>, AnyChannelDef>;

  registerChannelDefinitions(ctx.windows, handlers);
  const steamSettled = registerSteamIpcHandlers(
    ctx.acquireSteamToken,
    ctx.steamSessionStoreFor,
    ctx.windows,
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
  windows: WindowRegistry,
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
      const win = assertSender(windows, event, def.role);
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
  storeOrResolver: SteamSessionStore | ((win: BrowserWindow) => SteamSessionStore),
  windows?: WindowRegistry,
): () => Promise<void> {
  const storeFor = typeof storeOrResolver === "function"
    ? storeOrResolver
    : () => storeOrResolver;
  const coordinators = new Map<SteamSessionStore, SteamSessionCoordinator>();
  const coordinatorFor = (win: BrowserWindow): SteamSessionCoordinator => {
    const store = storeFor(win);
    let coordinator = coordinators.get(store);
    if (!coordinator) {
      coordinator = new SteamSessionCoordinator(store);
      coordinators.set(store, coordinator);
    }
    return coordinator;
  };

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
      const steam = coordinatorFor(win);
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

    steamStore: channel(asSteamStoreback, async (win, { token, expiry }) => {
      if (isQuitting()) throw new ValidationError("application is quitting");
      const steam = coordinatorFor(win);
      const outcome = await steam.refresh(token, expiry);
      logEvent({ k: "steam.storeback", outcome });
    }),

    steamClear: channel(nothing, async (win) => {
      if (isQuitting()) throw new ValidationError("application is quitting");
      const steam = coordinatorFor(win);
      try {
        await steam.clear();
        logEvent({ k: "steam.tokenCleared" });
      } catch (error) {
        logEvent({ k: "steam.tokenClearFailed", code: errorCode(error) });
        throw error;
      }
    }),
  } satisfies Record<SteamInvokeChannel, AnyChannelDef>;

  registerChannelDefinitions(windows ?? windowRegistry, handlers);
  return async () => {
    await Promise.all([...coordinators.values()].map((steam) => steam.settled()));
  };
}

export function emitSocketEvent(ownerId: number, event: SocketEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    if (win.webContents.id === ownerId) {
      sendIfLive(win, IPC.socketEvent, toWireSocketEvent(event));
    }
  }
}
