import type {
  DiagnosticSummary,
  RendererFrameBatch,
  RendererMilestone,
  RendererMilestoneFields,
  RendererMetrics,
} from "./diagnostics.js";
import type { ErrorCode } from "./errors.js";

export type BuildKind = "jspi";

export interface SnapshotMetadata {
  size: number;
  chunkSize: number;
  chunkHashes: string[];
  residentBits: Uint8Array;
}

/**
 * A client preparation that is still running. `label` and `notice` are the
 * last English the main process writes into this channel, and the renderer
 * already substitutes its own text for every phase but `image`.
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
  notice?: string;
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
}

export interface SocketOpenedEvent {
  type: "open";
  socketId: number;
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

/**
 * The complete set of independently selectable Enhancement features.
 *
 * Canonical here because settings, main-process policy, and the generated
 * preload transport all need the same names. A new tool is declared once;
 * its implementation still has to decide what enabling it does.
 */
export const ENHANCEMENTS = [
  "nativeCursor",
  "targetReadout",
] as const;

export type Enhancement = (typeof ENHANCEMENTS)[number];
export type EnhancementSelection = Record<Enhancement, boolean>;

export interface AppSettings extends EnhancementSelection {
  renderScale: 1 | 1.5 | 2;
  touchMode: "dbltap" | "translate" | "augment" | "off";
  showDiagnostics: boolean;
  dataStrategy: "quick" | "full" | null;
  /**
   * Opt in to automatic release checks. `false` means this app makes no
   * network request to GitHub unless the user asks for one — with no
   * exceptions, including the check on an uncertified client build.
   */
  autoCheckUpdates: boolean;
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
  nativeCursor: true,
  targetReadout: false,
  touchMode: "dbltap",
  showDiagnostics: false,
  dataStrategy: null,
  autoCheckUpdates: false,
  lastUpdateCheckAt: null,
  compatibilityNoticeSeenFor: null,
};

export interface StoredCredentials {
  username: string;
  password: string;
}

export type CredentialRead =
  | { readonly state: "absent" }
  | {
    readonly state: "available";
    readonly credentials: StoredCredentials;
  }
  | { readonly state: "temporarily-unavailable" };

export type ExternalLinkKind =
  | "github"
  | "discord"
  | "donate"
  | "releases"
  | "store";

// The application and website both use this canonical release location.
export const RELEASE_REPO = "Mat4m0/gwonmac";

export const EXTERNAL_URLS: Record<ExternalLinkKind, string> = {
  github: `https://github.com/${RELEASE_REPO}`,
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
export type ReleaseCheckFailure =
  | "rate-limited"
  | "offline"
  | "timeout"
  | "server"
  | "unreadable"
  | "unsupported-build";

/**
 * Three states, never two. `latestVersion` is re-rendered from the parsed
 * version rather than passed through from the API response, so no free text
 * from the network reaches the UI.
 */
export type ReleaseNotice =
  | {
      state: "update-available";
      currentVersion: string;
      latestVersion: string;
      checkedAt: number;
    }
  | {
      state: "up-to-date";
      currentVersion: string;
      latestVersion: string;
      checkedAt: number;
    }
  | {
      state: "unknown";
      currentVersion: string;
      reason: ReleaseCheckFailure;
      checkedAt: number;
    };

/**
 * Which of the three client-certification states this session is in. The two
 * WASM transforms are keyed by different hashes, so certification can succeed
 * for template save/load and fail for the Enhancement tools:
 *
 * - `certified`      templates, screenshots and chat logs work; Enhancement may load
 * - `template-only`  those three work; Enhancement may not load
 * - `uncertified`    ArenaNet's untouched module is served; nothing is repaired
 *
 * `src/main/client-certification.ts` is the only producer.
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
  healthToken: ClientHealthToken | null;
}

export const DESKTOP_PLATFORMS = ["macos", "windows", "linux"] as const;
export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];
export const RENDERER_ROLES = ["game", "control"] as const;
export type RendererRole = (typeof RENDERER_ROLES)[number];

export function isDesktopPlatform(value: unknown): value is DesktopPlatform {
  return DESKTOP_PLATFORMS.some((platform) => platform === value);
}

export function desktopPlatformFor(value: string): DesktopPlatform {
  if (value === "darwin") return "macos";
  if (value === "win32") return "windows";
  if (value === "linux") return "linux";
  throw new Error(`unsupported desktop platform: ${value}`);
}

/**
 * Everything the renderer must know before its first script runs. It used to
 * ride on the renderer URL as query parameters, which forced the trust root to
 * allow-list them — including `nativeCursor`, which is user product state and
 * has no business in a navigation check. It travels as a preload argument
 * instead, so `isCanonicalRendererUrl` accepts no query string at all.
 */
export interface RendererInit {
  /** Main-owned renderer role. Invalid or absent values expose no bridge. */
  rendererRole: RendererRole | null;
  /**
   * Main-derived operating system. `null` is the fail-closed preload result
   * when the trusted argument is missing or malformed.
   */
  desktopPlatform: DesktopPlatform | null;
  /** Enhancement automation tier. Unpackaged builds only. */
  enhancementAutomation: boolean;
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
 * `src/main/core/template-save-compat.ts` appends forwarders that hand the
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
  | { type: "settings.open" }
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
  credentialsLoad: "gw:credentials:load",
  credentialsSave: "gw:credentials:save",
  credentialsClear: "gw:credentials:clear",
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
  appRequestQuit: "gw:app:requestQuit",
  clientRetry: "gw:client:retry",
  clientHealthy: "gw:client:healthy",
  clientSession: "gw:client:session",
  // Main→renderer, and the renderer's acknowledgement. Main waits on the
  // acknowledgement because a capture flush has to finish inside the capture
  // window, which `executeJavaScript`'s awaited result used to guarantee.
  rendererCommand: "gw:renderer:command",
  rendererCommandDone: "gw:renderer:commandDone",
  // Named for its trigger: the renderer asks for a check, it does not read a
  // status the main process was already keeping.
  releaseNoticeCheck: "gw:releaseNotice:check",
  profilesList: "gw:profiles:list",
  profilesCreate: "gw:profiles:create",
  profilesRename: "gw:profiles:rename",
  profilesLaunch: "gw:profiles:launch",
  profilesClose: "gw:profiles:close",
  profilesForgetLogin: "gw:profiles:forgetLogin",
  profilesTrash: "gw:profiles:trash",
  profilesChanged: "gw:profiles:changed",
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
  "profilesChanged",
] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];

/** Every channel the renderer `invoke`s, i.e. every channel main must answer. */
export type InvokeChannel = Exclude<keyof typeof IPC, EventChannel>;

export const CONTROL_INVOKE_CHANNELS = [
  "profilesList",
  "profilesCreate",
  "profilesRename",
  "profilesLaunch",
  "profilesClose",
  "profilesForgetLogin",
  "profilesTrash",
] as const satisfies readonly InvokeChannel[];

export type ControlInvokeChannel =
  (typeof CONTROL_INVOKE_CHANNELS)[number];
export type GameInvokeChannel = Exclude<InvokeChannel, ControlInvokeChannel>;

export type ProfileRuntimeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "closing";

export interface ProfileSummary {
  readonly id: string;
  readonly label: string;
  readonly status: ProfileRuntimeStatus;
}

export interface GwControlApi {
  /** Launch-time configuration, available before the first control script. */
  readonly init: RendererInit;
  readonly profiles: {
    list(): Promise<readonly ProfileSummary[]>;
    create(label: string): Promise<void>;
    rename(id: string, label: string): Promise<void>;
    launch(id: string): Promise<void>;
    close(id: string): Promise<void>;
    forgetSavedLogin(id: string): Promise<void>;
    moveToTrash(id: string): Promise<void>;
    onChange(callback: () => void): () => void;
  };
}

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
  credentials: {
    load(): Promise<CredentialRead>;
    save(value: StoredCredentials): Promise<void>;
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
    requestQuit(): Promise<void>;
  };
  client: {
    retry(): Promise<void>;
    healthy(token: ClientHealthToken): Promise<void>;
    session(): Promise<ClientSession>;
  };
  releaseNotice: {
    check(): Promise<ReleaseNotice>;
  };
}
