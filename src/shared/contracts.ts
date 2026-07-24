import type {
  DiagnosticSummary,
  RendererFrameBatch,
  RendererMilestone,
  RendererMilestoneFields,
  RendererMetrics,
} from "./diagnostics.js";

export type BuildKind = "jspi";

export interface SnapshotMetadata {
  size: number;
  chunkSize: number;
  chunkHashes: string[];
  residentBits: Uint8Array;
}

export interface DownloadProgress {
  phase:
    | "starting"
    | "checking"
    | "client"
    | "image"
    | "ready"
    | "error";
  label: string;
  received: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
  error: string | null;
  notice?: string;
}

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

export interface SocketClosedEvent {
  type: "close";
  socketId: number;
  reason: string;
}

export interface SocketErrorEvent {
  type: "error";
  socketId: number;
  message: string;
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

export interface AppSettings {
  renderScale: 1 | 1.5 | 2;
  pointerLock: boolean;
  cursorTheme: "system" | "guild-wars" | "guild-wars-2";
  touchMode: "dbltap" | "translate" | "augment" | "off";
  showDiagnostics: boolean;
  dataStrategy: "quick" | "full" | null;
}

export type AppSettingsPatch = Partial<AppSettings>;

export const DEFAULT_SETTINGS: AppSettings = {
  renderScale: 1,
  pointerLock: true,
  cursorTheme: "guild-wars",
  touchMode: "dbltap",
  showDiagnostics: false,
  dataStrategy: null,
};

export interface StoredCredentials {
  username: string;
  password: string;
}

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

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string;
  url: string;
  hasUpdate: boolean;
}

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
  diagnosticsStartCapture: "gw:diagnostics:startCapture",
  diagnosticsStopCapture: "gw:diagnostics:stopCapture",
  diagnosticsExport: "gw:diagnostics:export",
  appOpenExternal: "gw:app:openExternal",
  appRequestQuit: "gw:app:requestQuit",
  clientRetry: "gw:client:retry",
  clientHealthy: "gw:client:healthy",
  updateStatus: "gw:update:status",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface GwNativeApi {
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
    load(): Promise<StoredCredentials | null>;
    save(value: StoredCredentials): Promise<void>;
    clear(): Promise<void>;
  };
  cache: {
    info(): Promise<CacheInfo>;
    clearAndRestart(): Promise<boolean>;
    downloadAll(): Promise<boolean>;
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
    startCapture(level: 1 | 2): Promise<void>;
    stopCapture(): Promise<void>;
    export(): Promise<string>;
  };
  app: {
    openExternal(kind: ExternalLinkKind): Promise<void>;
    requestQuit(): Promise<void>;
  };
  client: {
    retry(): Promise<void>;
    healthy(): Promise<void>;
  };
  update: {
    status(): Promise<UpdateStatus | null>;
  };
}
