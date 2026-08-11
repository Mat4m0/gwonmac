/**
 * The canonical contracts between main, the preload and the renderer: the IPC
 * channels, the settings, the progress and socket shapes, the Enhancement
 * capability profiles, the ceiling on requests in flight to ArenaNet, and the
 * closed vocabularies each side validates against.
 *
 * These are types and frozen values only. Nothing here has behaviour, imports
 * Electron, or touches a filesystem, which is what lets both processes and the
 * generated preload share one definition rather than three copies that agree
 * until they do not.
 *
 * The closed unions are the load-bearing part. A channel, a notice, a refusal
 * or a capability profile exists only if it is listed here, so adding one is a
 * deliberate edit that the compiler then demands both sides honour. Codes cross
 * these boundaries; the sentence a player reads is written in the renderer,
 * where it can be tested against what is actually shown.
 */
import type {
  DiagnosticSummary,
  RendererFrameBatch,
  RendererMilestone,
  RendererMilestoneFields,
  RendererMetrics,
} from "./diagnostics.js";
import type { ErrorCode } from "./errors.js";
import type { BuildLibrary } from "./builds/library.js";
import type {
  EnhancementProgram,
  EnhancementSelection,
} from "./enhancement-contracts.js";
import { RELEASE_REPO } from "./project-identity.js";
import {
  DEFAULT_UPDATE_TRACK,
  UPDATE_TRACKS,
  type UpdateTrack,
} from "./release.js";

export { RELEASE_REPO } from "./project-identity.js";
export { DEFAULT_UPDATE_TRACK, UPDATE_TRACKS };
export type { UpdateTrack };

export type BuildKind = "jspi";

export interface SnapshotMetadata {
  size: number;
  chunkSize: number;
  chunkHashes: string[];
  residentBits: Uint8Array;
}

/**
 * Requests in flight to ArenaNet, summed over every scheduler this application
 * runs: the main process chunk store and patch client, and the renderer's
 * snapshot image reader. They spend one budget against infrastructure every
 * installation shares, so lowering this is a decision and raising it is a
 * defect.
 */
export const ARENANET_REQUEST_CEILING = 8;

/**
 * The game client's WASM heap maximum, compiled into ArenaNet's build: the
 * glue's `getHeapMax()` returns exactly this. Every surface that reasons
 * about heap headroom — the renderer's watermark notice, the crash detail,
 * the diagnostics summary — derives from this one number, so a future client
 * built with a larger cap (`-sMAXIMUM_MEMORY=4GB` is the upstream ask) is a
 * one-line change here rather than a hunt for stale "2048 MiB" literals.
 */
export const WASM_HEAP_CAP_BYTES = 2_147_483_648;

/**
 * The bounds a build template transfer is held to, in both directions.
 *
 * One declaration because two processes enforce them and must not disagree:
 * `src/renderer/template-format.ts` applies them while parsing what a player
 * picked, and `src/main/template-export.ts` re-applies them to the payload that
 * arrives over IPC, which is the only version of these numbers that is a trust
 * boundary rather than a format rule.
 *
 * `entries` sits well past the game's own 550-per-root ceiling, so a real
 * collection is never refused; it is here to bound one gesture. `nameLength`
 * is the client's `WCHAR name[260]` record minus `.txt` and its terminator —
 * `matchingEntries` in `src/renderer/template-save-compatibility.ts` drops
 * anything at or past that, so a longer name would import successfully and
 * then be invisible in game.
 */
export const TEMPLATE_CEILINGS = {
  entries: 4_000,
  codeLength: 512,
  nameLength: 255,
} as const;

/**
 * One build template on its way out to a folder the player chose. `path` is
 * relative to that folder, `/`-separated, and already sanitised by the renderer
 * that read it out of the mount; `src/main/template-export.ts` re-checks it
 * before writing, because a path is the one field that decides where a write
 * lands. `contents` is the code alone — the game writes no trailing newline and
 * a file that gains one stops being the same file.
 */
export interface TemplateExportEntry {
  path: string;
  contents: string;
}

/**
 * How an export ended. A value rather than a rejection for the same reason
 * `FullDownloadOutcome` is one: Electron flattens a rejection to its message,
 * and the sentence belongs to `src/renderer/failure-messages.ts`.
 */
export type TemplateExportResult =
  | { status: "cancelled" }
  | { status: "written"; count: number }
  | { status: "failed"; errorCode: ErrorCode };

/**
 * Why a ready client is not simply "ready": the launch took a fallback the
 * player may want to know about. A closed union for the same reason failure
 * codes are one: the sentence the player reads belongs to the renderer
 * (`src/renderer/failure-messages.ts`), where it can be tested.
 */
export const NOTICE_CODES = [
  "cached-live-probe",
  "rejected-candidate-fallback",
  "update-failed-previous-restored",
  "offline-using-cached-client",
  "interrupted-update-retryable",
] as const;

export type NoticeCode = (typeof NOTICE_CODES)[number];

/**
 * A client preparation that is still running. `label` is the last English the
 * main process writes into this channel, and the renderer already substitutes
 * its own text for every phase but `image`.
 */
export interface DownloadActivity {
  phase:
    | "starting"
    | "checking"
    | "client"
    | "image"
    | "ready";
  label: string;
  received: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
  noticeCode?: NoticeCode;
}

/**
 * A client preparation that failed. The code is the entire payload: this used
 * to be a finished English sentence built in the main process, which put the
 * wording of a user-facing failure in the one place that cannot see the UI and
 * cannot be tested against it. `src/renderer/failure-messages.ts` is now the
 * only place that sentence is chosen, and a code is also the only thing the
 * diagnostics export is allowed to carry.
 *
 * A separate member rather than a nullable field on the one above, so that a
 * failure without a code and a code without a failure are both build errors.
 */
export interface DownloadFailure {
  phase: "error";
  errorCode: ErrorCode;
}

export type DownloadProgress = DownloadActivity | DownloadFailure;

/**
 * How a full-game download ended. It replaces a `boolean` plus a rejected
 * promise carrying an English sentence: Electron flattens a rejection to its
 * message, so a *value* is the only way a code can cross to the renderer, and
 * the renderer is where the sentence belongs. Verified data survives all
 * three, which is why "failed" needs no separate "how much was kept".
 */
export type FullDownloadOutcome =
  | { status: "complete" }
  | { status: "stopped" }
  | { status: "failed"; errorCode: ErrorCode };

export interface PrefetchProgress {
  completedChunks: number;
  totalChunks: number;
}

export interface CacheInfo {
  bytes: number;
  chunks: number;
  totalBytes: number;
  totalChunks: number;
  /**
   * Free bytes on the game-data volume when this info was built, or -1 when
   * the volume could not be measured. Advisory: the download preflight in
   * chunk-store.ts re-measures and is the enforcement.
   */
  freeBytes: number;
  /**
   * How many more bytes must be freed before the full download could start,
   * or 0 when it fits (or cannot be judged). Computed in the main process
   * beside the preflight's own margin, because the renderer cannot import
   * that constant at runtime and a second copy of it would drift.
   */
  fullDownloadShortfall: number;
}

export interface SocketOpenedEvent {
  type: "open";
  socketId: number;
  /** Destination port from the closed allowlist; never a host name. */
  port: number;
}

export interface SocketDataEvent {
  type: "data";
  socketId: number;
  data: Uint8Array;
}

/**
 * Why a socket closed. Closed vocabulary because this value crosses to the
 * renderer *and* into the diagnostics export; it used to be free text, and one
 * of its five producers passed `error.message` straight through.
 */
export type SocketCloseReason =
  | "requested"
  | "peer"
  | "owner"
  | "timeout"
  | "error";

/**
 * Why a socket failed. Node's `errno` set is open and its messages quote the
 * destination address, so failures are classified into this allowlist and
 * anything unrecognised becomes "other".
 */
export type SocketFailureCode =
  | "timeout"
  | "refused"
  | "reset"
  | "unreachable"
  | "dns"
  | "other";

export interface SocketClosedEvent {
  type: "close";
  socketId: number;
  reason: SocketCloseReason;
}

export interface SocketErrorEvent {
  type: "error";
  socketId: number;
  code: SocketFailureCode;
}

export type SocketEvent =
  | SocketOpenedEvent
  | SocketDataEvent
  | SocketClosedEvent
  | SocketErrorEvent;

export interface GraphicsDiagnostics {
  userAgent: string;
  jspi: boolean;
  webglVersion: string;
  renderer: string;
  vendor: string;
  hardwareAcceleration: boolean;
  canvasWidth: number;
  canvasHeight: number;
  offscreenWidth: number;
  offscreenHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  devicePixelRatio: number;
  renderScale: AppSettings["renderScale"];
  antialias: boolean;
  samples: number;
}

export interface ClockSyncResponse {
  mainReceiveUs: number;
  mainSendUs: number;
}

export const UI_STYLES = ["guild-wars", "obsidian"] as const;
export type UiStyle = (typeof UI_STYLES)[number];
export const RENDER_SCALES = [1, 1.5, 2] as const;
export type RenderScale = (typeof RENDER_SCALES)[number];
export const UI_PANEL_OPACITY_MIN = 65;
export const UI_PANEL_OPACITY_MAX = 100;
export const DATA_STRATEGIES = [null, "quick", "full"] as const;
export type DataStrategy = (typeof DATA_STRATEGIES)[number];
export const LAST_UPDATE_CHECK_AT_MAX = 8_640_000_000_000_000;

export interface AppSettings {
  renderScale: RenderScale;
  /** The visual treatment applied to every GWonMac panel. */
  uiStyle: UiStyle;
  /**
   * The application's Guild Wars panels stay translucent enough to see the
   * game behind them. This is presentation only and never reaches the game.
   */
  uiPanelOpacity: number;
  /** Master opt-in for the optional executable Tools Beta capability. */
  gwonmacTools: boolean;
  /** Live selection restored whenever optional tools are allowed. */
  teamManagement: boolean;
  /** Experimental live target distance/range readout. */
  targetReadout: boolean;
  /** Request the certified 4 GB client module on the next Guild Wars launch. */
  extendedMemoryEnabled: boolean;
  showDiagnostics: boolean;
  dataStrategy: DataStrategy;
  /**
   * Automatic release checks: a GitHub request at launch, then at most one
   * every six hours while the app stays open, on by default so players stay
   * current, and declared plainly wherever the checkbox appears. `false`
   * means this app makes no network request to GitHub unless the user asks
   * for one — with no exceptions, including the check on an uncertified
   * client build. Opting out is one checkbox, honored forever.
   */
  autoCheckUpdates: boolean;
  /**
   * Which release stages the one release updater may discover. This is a
   * preference inside the `release` distribution identity, not a package or
   * Keychain identity. Stable is the safe default; Beta additionally admits
   * beta and release-candidate builds, never alpha builds.
   */
  updateTrack: UpdateTrack;
  /**
   * When the last release-check attempt completed, in epoch milliseconds, or
   * `null` if one has never run. An unsupported local build can finish without
   * contacting GitHub; this records the attempt, not a network claim.
   */
  lastUpdateCheckAt: number | null;
  /**
   * The ArenaNet client build (its official module's sha256) whose
   * compatibility notice the player has already seen, or `null` for none.
   *
   * Keyed by build rather than by a boolean on purpose: a new ArenaNet build
   * has to warn again, and the same one must not nag every launch. It is not
   * nested with the two update fields above because it is not about updating
   * this app — it records what the player was told about *their game client*.
   */
  compatibilityNoticeSeenFor: string | null;
}

export type AppSettingsPatch = Partial<AppSettings>;

export const DEFAULT_SETTINGS: AppSettings = {
  renderScale: 2,
  uiStyle: "guild-wars",
  uiPanelOpacity: 94,
  gwonmacTools: false,
  teamManagement: true,
  targetReadout: false,
  extendedMemoryEnabled: false,
  showDiagnostics: false,
  dataStrategy: null,
  autoCheckUpdates: true,
  updateTrack: DEFAULT_UPDATE_TRACK,
  lastUpdateCheckAt: null,
  compatibilityNoticeSeenFor: null,
};

export interface StoredCredentials {
  username: string;
  password: string;
}

/**
 * Why an interactive Steam sign-in produced no token. A closed vocabulary that
 * crosses to the renderer so the player can be told what happened instead of
 * silently landing back on the login screen; the sentence itself lives in
 * `src/renderer/failure-messages.ts`. `cancelled` stays silent by design —
 * the player closed the window and needs no explanation of their own action.
 */
export type SteamRefusalReason =
  | "cancelled"
  | "state-mismatch"
  | "no-token"
  | "failed";

/**
 * What a Steam token request produced. `reason` is present only when an
 * interactive sign-in ran and did not complete; a silent probe with nothing
 * stored answers `{ token: null }` alone, which is a normal launch, not news.
 */
export interface SteamTokenResult {
  token: string | null;
  reason?: SteamRefusalReason;
}

export type ExternalLinkKind =
  | "github"
  | "bugReport"
  | "featureRequest"
  | "discord"
  | "donate"
  | "releases"
  | "store";

/**
 * Directories the renderer may ask to reveal in Finder. A closed enum, never
 * a path: the renderer names an intent, main resolves the location, and no
 * filesystem path crosses the bridge in either direction.
 */
export type RevealKind = "gameData";

// The application and website both use this canonical release location.
export const EXTERNAL_URLS: Record<ExternalLinkKind, string> = {
  github: `https://github.com/${RELEASE_REPO}`,
  bugReport: `https://github.com/${RELEASE_REPO}/issues/new?template=bug-report.yml`,
  featureRequest: `https://github.com/${RELEASE_REPO}/issues/new?template=feature-request.yml`,
  discord: "https://discord.gg/Z9ft52RBD3",
  donate: "https://ko-fi.com/mat4m0",
  releases: `https://github.com/${RELEASE_REPO}/releases`,
  // Official ArenaNet store, for players who do not own the game yet.
  store: "https://store.guildwars.com/en-us",
};

/**
 * Why a release check produced no answer. Closed vocabulary because the
 * renderer renders one message per member, and because "we could not tell"
 * must never arrive looking like "you are up to date".
 *
 * `rate-limited` is separate from `server` on purpose: GitHub allows 60
 * unauthenticated requests per hour per IP, and a manual button invites
 * mashing, so that case needs its own sentence.
 */
export type AppUpdateErrorCode =
  | "rate-limited"
  | "offline"
  | "timeout"
  | "server"
  | "unreadable"
  | "unsupported-build"
  | "updater-unavailable"
  | "feed-invalid"
  | "download-failed";

/**
 * One closed state union. `latestVersion` is re-rendered from the parsed
 * version rather than passed through from the API response, so no free text
 * from the network reaches the UI.
 */
export type AppUpdateState =
  | {
      phase: "idle";
      currentVersion: string;
      lastCheckedAt?: string;
    }
  | {
      phase: "checking";
      currentVersion: string;
      lastCheckedAt?: string;
    }
  | {
      phase: "up-to-date";
      currentVersion: string;
      latestVersion: string;
      checkedAt: string;
    }
  | {
      phase: "downloading";
      currentVersion: string;
      latestVersion: string;
      checkedAt: string;
    }
  | {
      phase: "ready";
      currentVersion: string;
      latestVersion: string;
      checkedAt: string;
    }
  | {
      /**
       * Returning to Stable would be a downgrade, which Squirrel must never
       * perform. The renderer may open only the fixed Releases page and name
       * this exact stable version; no asset URL crosses the bridge.
       */
      phase: "manual-stable-return";
      currentVersion: string;
      checkedAt: string;
      stableVersion: string;
    }
  | {
      phase: "failed";
      currentVersion: string;
      lastCheckedAt?: string;
      reason: AppUpdateErrorCode;
    };

export type SettingsPane =
  | "data"
  | "templates"
  | "display"
  | "controls"
  | "updates"
  | "advanced";

/**
 * Which of the three client-certification states this session is in. The two
 * WASM transforms are keyed by different hashes, so certification can succeed
 * for template save/load and fail for the Enhancement tools:
 *
 * - `certified`      templates, screenshots and chat logs work; Enhancement may load
 * - `template-only`  those three work; Enhancement may not load
 * - `uncertified`    ArenaNet's untouched module is served; nothing is repaired
 *
 * `src/main/certification/client-certification.ts` is the only producer.
 */
export type ClientCompatibilityState =
  | "certified"
  | "template-only"
  | "uncertified";

export interface ClientCompatibility {
  state: ClientCompatibilityState;
  /**
   * sha256 of ArenaNet's official module for this session. It names the build,
   * so a notice can be acknowledged per build instead of per launch.
   */
  clientSha256: string;
  /**
   * Whether the module selected for this session contains the certified
   * Enhancement transform. This is effective runtime state, not build support.
   */
  enhancementActive: boolean;
}

/**
 * The memory module selected for this running client. Saved intent is kept
 * separate in AppSettings; this is the launch result and therefore the only
 * source for claims about what the current session is actually using.
 */
export type ExtendedMemoryRuntimeStatus =
  | Readonly<{
      requestedAtLaunch: false;
      status: "standard";
      effectiveCapBytes: typeof WASM_HEAP_CAP_BYTES;
      fallbackReason: null;
    }>
  | Readonly<{
      requestedAtLaunch: true;
      status: "active";
      effectiveCapBytes: number;
      fallbackReason: null;
    }>
  | Readonly<{
      requestedAtLaunch: true;
      status: "unavailable";
      effectiveCapBytes: typeof WASM_HEAP_CAP_BYTES;
      fallbackReason: "unsupported-client" | "preparation-failed";
    }>;

/**
 * The candidate generation this renderer is serving. A renderer captures it
 * before loading the game glue and returns that exact value only after its own
 * first-frame and socket-open evidence. Main refuses a token for any other
 * active generation or candidate marker.
 */
export interface ClientHealthToken {
  readonly generation: number;
  readonly fingerprint: string;
}

/**
 * What this session is running. `compatibility` is `null` only before a client
 * has been activated; `appVersion` is always known, because a user filing a bug
 * should not have to hunt through the menu bar for it. `healthToken` exists
 * only while the active generation is awaiting renderer health evidence.
 */
export interface ClientSession {
  appVersion: string;
  compatibility: ClientCompatibility | null;
  extendedMemory: ExtendedMemoryRuntimeStatus | null;
  healthToken: ClientHealthToken | null;
}

/**
 * Everything the renderer must know before its first script runs. It used to
 * ride on the renderer URL as query parameters, which forced the trust root to
 * allow-list them — including the Core cursor capability, which is launch
 * state and has no business in a navigation check. It travels as a preload argument
 * instead, so `isCanonicalRendererUrl` accepts no query string at all.
 */
export interface RendererInit {
  /** Enables bounded console evidence. Always false in packaged builds. */
  development: boolean;
  /** Fixed developer program for this launch. Always `none` when packaged. */
  enhancementProgram: EnhancementProgram;
  /** The independently selected Enhancement tools for this launch. */
  enhancementSelection: EnhancementSelection;
  /** Template filesystem syscall trace. Unpackaged builds only. */
  templateFsTrace: boolean;
}

/**
 * Prefix of the single `webPreferences.additionalArguments` entry that carries
 * a JSON `RendererInit`. The preload is the only reader.
 */
export const RENDERER_INIT_ARGUMENT = "--gw-renderer-init=";

/**
 * dirfd markers by which ArenaNet's derived client reaches the renderer.
 * `src/main/certification/template-save-compat.ts` appends forwarders that hand the
 * stub's arguments to `__syscall_newfstatat` behind one of these, and
 * `src/renderer/template-save-compatibility.ts` answers them against the
 * mounted IDBFS. No real call can produce a negative dirfd.
 *
 * Canonical here rather than beside the transform because both halves need the
 * values and neither can import the other: the renderer is a sandboxed classic
 * script, so its copy travels through the generated preload. When the two were
 * hand-mirrored, drift silently turned every bridged call into an ordinary
 * `stat` — no error, no log, just templates that stopped saving.
 */
export const WASM_BRIDGE_MARKERS = {
  ensureDirectory: -70_001,
  findFiles: -70_002,
  fileBaseName: -70_003,
  deleteFile: -70_004,
  fileExists: -70_005,
} as const;

export type WasmBridgeMarkers = typeof WASM_BRIDGE_MARKERS;

/**
 * The closed set of things the main process asks the renderer to do. These
 * arrived as JavaScript source built by string interpolation and run with
 * `executeJavaScript` — one of them spliced a capture level into the source.
 * They are events, so they travel as events and `level` travels as a number.
 */
export type RendererCommand =
  | { type: "input.reset" }
  | { type: "tools.toggle" }
  | {
      type: "settings.open";
      pane?: SettingsPane;
      checkForUpdates?: boolean;
    }
  | { type: "filesystem.sync" }
  | { type: "input.trace" }
  | { type: "diagnostics.toggle" }
  | {
      type: "diagnostics.capture";
      action: "reset" | "stopped" | "flush" | "problem-marked";
    }
  | { type: "diagnostics.capture"; action: "started"; level: 1 | 2 };

/** What the renderer can truthfully acknowledge over IPC. */
export type RendererCommandCompletion = "completed" | "failed";

/** Main adds its own bounded-wait result to the renderer's acknowledgement. */
export type RendererCommandOutcome =
  | RendererCommandCompletion
  | "timed-out";

/**
 * The two `gw://` routes the build editor fetches.
 *
 * Named here for the same reason `IPC` is: both sides of a process boundary
 * spell them, and a rename that only lands on one side compiles, lints, and
 * fails at runtime as an empty skill picker. `src/main/protocol.ts` serves
 * them and `apps/tools/src/host.ts` asks for them.
 */
export const SKILL_CATALOGUE_ROUTE = "skill-catalog.json";
export const SKILL_ICON_ROUTE = (skillId: number): string =>
  `skill-icons/${skillId}.bmp`;
/** What `SKILL_ICON_ROUTE` produces, as the server's matcher. */
export const SKILL_ICON_PATTERN = /^skill-icons\/([0-9]{1,7})\.bmp$/u;

export const IPC = {
  progressCurrent: "gw:progress:current",
  progressEvent: "gw:progress:event",
  prefetchEvent: "gw:prefetch:event",
  snapshotMetadata: "gw:snapshot:metadata",
  dnsResolve: "gw:dns:resolve",
  socketConnect: "gw:socket:connect",
  socketSend: "gw:socket:send",
  socketClose: "gw:socket:close",
  socketEvent: "gw:socket:event",
  settingsGet: "gw:settings:get",
  settingsSet: "gw:settings:set",
  settingsReset: "gw:settings:reset",
  buildLibraryGet: "gw:buildLibrary:get",
  buildLibrarySet: "gw:buildLibrary:set",
  credentialsLoad: "gw:credentials:load",
  credentialsSave: "gw:credentials:save",
  credentialsClear: "gw:credentials:clear",
  steamToken: "gw:steam:token",
  steamStore: "gw:steam:store",
  steamClear: "gw:steam:clear",
  cacheInfo: "gw:cache:info",
  cacheClear: "gw:cache:clear",
  cacheDownloadAll: "gw:cache:downloadAll",
  cacheStopDownload: "gw:cache:stopDownload",
  gameStorageReset: "gw:gameStorage:reset",
  diagnosticsGraphics: "gw:diagnostics:graphics",
  diagnosticsClockSync: "gw:diagnostics:clockSync",
  diagnosticsClockResult: "gw:diagnostics:clockResult",
  diagnosticsRendererMetrics: "gw:diagnostics:rendererMetrics",
  diagnosticsRendererFrames: "gw:diagnostics:rendererFrames",
  diagnosticsRendererMilestone: "gw:diagnostics:rendererMilestone",
  diagnosticsCurrent: "gw:diagnostics:current",
  appOpenExternal: "gw:app:openExternal",
  appRevealPath: "gw:app:revealPath",
  appRequestQuit: "gw:app:requestQuit",
  clipboardWriteText: "gw:clipboard:writeText",
  clipboardReadText: "gw:clipboard:readText",
  templatesExport: "gw:templates:export",
  clientRetry: "gw:client:retry",
  clientHealthy: "gw:client:healthy",
  clientSession: "gw:client:session",
  // Main→renderer, and the renderer's acknowledgement. Main waits on the
  // acknowledgement because a capture flush has to finish inside the capture
  // window, which `executeJavaScript`'s awaited result used to guarantee.
  rendererCommand: "gw:renderer:command",
  rendererCommandDone: "gw:renderer:commandDone",
  appUpdatesGetState: "gw:appUpdates:getState",
  appUpdatesCheck: "gw:appUpdates:check",
  appUpdatesRestartAndInstall: "gw:appUpdates:restartAndInstall",
  appUpdatesState: "gw:appUpdates:state",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/**
 * The channels that are not request/response and so have no `ipcMain.handle`
 * handler: three main→renderer events, the main→renderer command, and the
 * renderer's acknowledgement of it, which is an `ipcRenderer.send`.
 *
 * Named here so `InvokeChannel` below can be derived rather than listed. The
 * handler registry in `src/main/ipc.ts` is checked against it, which is what
 * makes a channel with no handler — and a handler with no channel — a build
 * failure instead of a runtime "no handler registered".
 */
export const EVENT_CHANNELS = [
  "progressEvent",
  "prefetchEvent",
  "socketEvent",
  "rendererCommand",
  "rendererCommandDone",
  "appUpdatesState",
] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];

/** Every channel the renderer `invoke`s, i.e. every channel main must answer. */
export type InvokeChannel = Exclude<keyof typeof IPC, EventChannel>;

export interface GwNativeApi {
  /** Launch-time configuration, available before the first renderer script. */
  init: RendererInit;
  /**
   * The derived client's dirfd markers. Not a capability — a constant the
   * sandboxed renderer cannot import, carried by the one bridge that can.
   */
  wasmBridgeMarkers: WasmBridgeMarkers;
  commands: {
    /**
     * Register the renderer's single command handler. A second registration is
     * an error. Main receives success or failure only after the returned
     * promise settles, so an awaited capture flush cannot be acknowledged
     * early or have a rejection disguised as success.
     */
    handle(handler: (command: RendererCommand) => void | Promise<void>): void;
  };
  progress: {
    current(): Promise<DownloadProgress>;
    onChange(callback: (value: DownloadProgress) => void): () => void;
    onPrefetch(callback: (value: PrefetchProgress) => void): () => void;
  };
  snapshot: {
    metadata(): Promise<SnapshotMetadata>;
  };
  dns: {
    resolve(name: string): Promise<string>;
  };
  sockets: {
    connect(destination: string): Promise<number>;
    send(socketId: number, data: Uint8Array): Promise<void>;
    close(socketId: number): Promise<void>;
    onEvent(callback: (event: SocketEvent) => void): () => void;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(value: AppSettingsPatch): Promise<AppSettings>;
    reset(): Promise<AppSettings | null>;
  };
  buildLibrary: {
    get(): Promise<{ library: BuildLibrary; recovered: boolean }>;
    set(value: BuildLibrary): Promise<BuildLibrary>;
  };
  credentials: {
    load(): Promise<StoredCredentials | null>;
    save(value: StoredCredentials): Promise<void>;
    clear(): Promise<void>;
  };
  /**
   * The Steam login token, which the game client redeems in `login.xml`.
   *
   * Deliberately a sibling of `credentials` rather than part of it: the two
   * secrets have different shapes and different validators, and `credentials`
   * is the one the saved-login invariant is written about.
   *
   * Fetched on demand and never cached in the renderer, so the token exists
   * there only for as long as it takes to hand to the client.
   */
  steam: {
    /**
     * The token to log in with, or a refusal.
     *
     * `silent` is the client's launch-time probe: it may only read what is
     * already stored. A non-silent request is the player having clicked the
     * button, and is the only thing that may open a Steam sign-in window.
     */
    getToken(silent: boolean): Promise<SteamTokenResult>;
    /**
     * Hand back what the account service returned. Refreshes the stored
     * expiry only when the token matches the one already held; anything else
     * is ignored, because overwriting a working credential with a value that
     * cannot be replayed would cost the player their next login.
     */
    store(token: string, expiry: number | null): Promise<void>;
    /** Forget the stored token. Signing out here does not unlink the account. */
    clear(): Promise<void>;
  };
  cache: {
    info(): Promise<CacheInfo>;
    clearAndRestart(): Promise<boolean>;
    downloadAll(): Promise<FullDownloadOutcome>;
    stopDownload(): Promise<void>;
  };
  gameStorage: {
    resetAndRestart(): Promise<boolean>;
  };
  diagnostics: {
    clockSync(rendererNowUs: number): Promise<ClockSyncResponse>;
    recordClockOffset(offsetUs: number, rttUs: number): Promise<void>;
    recordGraphics(value: GraphicsDiagnostics): Promise<void>;
    recordRendererMetrics(value: RendererMetrics): Promise<void>;
    recordRendererFrames(value: RendererFrameBatch): Promise<void>;
    recordRendererMilestone(
      name: RendererMilestone,
      rendererTimestampUs: number,
      fields?: RendererMilestoneFields,
    ): Promise<void>;
    current(): Promise<DiagnosticSummary>;
  };
  app: {
    openExternal(kind: ExternalLinkKind): Promise<void>;
    /** Reveal a named app directory in Finder. */
    reveal(kind: RevealKind): Promise<void>;
    requestQuit(): Promise<void>;
  };
  clipboard: {
    /**
     * Copy out of the game's text proxy. The Emscripten client ships no
     * clipboard platform layer, so the only text that can truthfully reach
     * the OS clipboard is what a proxy field holds; canvas-rendered text
     * never arrives here.
     */
    writeText(text: string): Promise<void>;
    /**
     * Read the OS pasteboard so a player can import build codes they copied
     * from a guild page or a forum post.
     *
     * This is the one capability here that widens what the renderer can reach:
     * whatever was last copied — plausibly a password — becomes readable by a
     * process that persists files. It is bounded by the same ceiling as the
     * write direction, it is only ever called from an explicit "Import from
     * Clipboard" click, and nothing it returns is written until the player has
     * seen the parsed result and confirmed it.
     */
    readText(): Promise<string>;
  };
  templates: {
    /**
     * Write the game's saved build templates into a folder the player chooses.
     * The renderer supplies the tree because only it can see the mount; main
     * owns the dialog, the destination, and the refusal of any path that would
     * not stay inside it.
     */
    export(
      entries: readonly TemplateExportEntry[],
    ): Promise<TemplateExportResult>;
  };
  client: {
    retry(): Promise<void>;
    healthy(token: ClientHealthToken): Promise<void>;
    session(): Promise<ClientSession>;
  };
  appUpdates: {
    getState(): Promise<AppUpdateState>;
    check(): Promise<void>;
    restartAndInstall(): Promise<void>;
    onState(callback: (state: AppUpdateState) => void): () => void;
  };
}
