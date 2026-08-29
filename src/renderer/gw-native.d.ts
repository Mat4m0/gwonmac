/**
 * The renderer's global surface: `window.gwNative`, the controllers the host
 * installs alongside it, and the shape of `Module` as this application uses it.
 *
 * Declarations only. Everything named here is implemented elsewhere — in the
 * preload, in the harness, or by ArenaNet's generated glue — so this file
 * changes nothing at runtime. It exists so the renderer's classic scripts are
 * checked against one description of that surface rather than against each
 * other's assumptions.
 */
import type {
  AppSettings,
  RendererGwNativeApi,
} from "../shared/contracts.js";
import type {
  VisualCaptureFailure,
  VisualCaptureMetadata,
} from "../shared/visual-capture.js";
import type {
  RendererEventName,
  RendererMetrics,
  TextureMemorySnapshot,
} from "../shared/diagnostics.js";
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type { PublishedCompanionState } from "./companion-snapshot.js";
import type { VirtualGamepadController } from "./virtual-gamepad.js";
import type { ControllerPromptTextureStats } from "./controller-prompt-texture.js";
import type { CartographyGridStats } from "./cartography-spike/overlay.js";
import type {
  CompassFrameSpikeController,
  ExplorationSpikeController,
  MissionMapFrameSpikeController,
  PathingSpikeController,
  WorldMapAnchorSpikeController,
} from "../shared/cartography-spike.js";
import type { CompanionSkillSlotState } from "./companion-interface-geometry-snapshot.js";
import type {
  InputTrace as SharedInputTrace,
  InputTraceEntry as SharedInputTraceEntry,
  InputTraceRecord as SharedInputTraceRecord,
} from '../shared/input-trace.js';

/**
 * Negative type test, run by every `tsc -p tsconfig.renderer.json`.
 *
 * `AppSettings` was used below without being imported, and `skipLibCheck: true`
 * hid the unresolved name, so the three renderer entry points that take
 * settings were typed against nothing. This declaration must stay an error: if
 * `AppSettings` ever stops constraining again, `renderScale: 3` becomes legal,
 * the directive goes unused, and `tsc` fails on that instead. It is exported
 * only because a type nothing references is not checked for use — it is not a
 * type to build on.
 */
// @ts-expect-error `renderScale` is the closed union 1 | 1.5 | 2; 3 is not a member.
export interface AppSettingsNegativeTypeTest extends AppSettings {
  renderScale: 3;
}

declare global {
  interface WindowEventMap {
    "gwonmac:chat-geometry": CustomEvent<CompanionSkillSlotState>;
  }
  interface GameInputDiagnostics {
    event(name: string, value?: unknown): void;
  }

  interface GameInputController {
    releaseAll(): void;
    traceState(): void;
    cancelAutomaticEnter(): void;
    setLoginProviderChooser(visible: boolean): void;
    expectCharacterSelection(): void;
    submitSavedLogin(expiresAt?: number): Promise<AutomaticEnterOutcome>;
    playSelectedCharacter(): Promise<AutomaticEnterOutcome>;
    acceptReconnect(): Promise<AutomaticEnterOutcome>;
  }

  type AutomaticEnterOutcome =
    | "sent"
    | "physical"
    | "progressed"
    | "unfocused"
    | "cancelled";

  interface GwonmacSurfaceHandle {
    setOpen(open: boolean): void;
    raise(): void;
    dispose(): void;
  }

  interface GwonmacSurfaceController {
    register(surface: Readonly<{
      root: HTMLElement;
      priority: number;
      dismiss(): void;
    }>): GwonmacSurfaceHandle;
  }

  type InputTraceEntry = SharedInputTraceEntry;
  type InputTraceRecord = SharedInputTraceRecord;
  type InputTrace = SharedInputTrace;

  interface LoadingController {
    set(message: string, fraction: number | null, detail?: string): void;
    fail(message: string, detail?: string): void;
    failFilesystem(): void;
    /**
     * The running game client crashed; count is per app run. `technicalDetail`
     * is the abort's own prose plus heap size — it renders behind a disclosure
     * on the overlay and never leaves the renderer; an omitted value keeps the
     * text a previous call supplied, so the repeat-crash copy upgrade cannot
     * erase it.
     */
    failCrash(crashCount: number, technicalDetail?: string): void;
    done(): void;
    waitForClient(): Promise<boolean>;
  }

  interface ArenaNetEglImports {
    eglCreateContext(...args: unknown[]): unknown;
    eglSwapBuffers(...args: unknown[]): unknown;
    emscripten_get_device_pixel_ratio?: () => number;
    emscripten_set_canvas_element_size?(
      target: unknown,
      width: number,
      height: number,
    ): unknown;
  }

  interface ArenaNetGraphicsModule {
    canvas: HTMLCanvasElement | OffscreenCanvas;
  }

  interface RendererDiagnostics {
    resetForCapture(): Promise<void>;
    captureStarted(level: 1 | 2): void;
    captureStopped(): void;
    problemMarked(): void;
    visualProblem(token?: string): Promise<void>;
    event(name: RendererEventName, value?: unknown): void;
    snapshot(
      durationUs: number,
      bytes: number,
      source: "memory" | "native",
    ): void;
    cache(source: "memory" | "native" | "coalesced"): void;
    glProgramQuery(hit: boolean): void;
    scheduler(event: "eviction" | "promotion"): void;
    socketSend(
      started: number,
      syncUs: number,
      payloadBytes: number,
      sourceBackingBytes: number,
      compactBytes: number,
      pending: PromiseLike<unknown>,
    ): void;
    setVisible(visible: boolean): void;
    swap(
      swapUs: number,
      bitmapOutUs: number,
      bitmapPresentUs: number,
      presented?: boolean,
    ): void;
    flush(): Promise<void>;
  }

  interface VisualCaptureLease {
    webglPng: Uint8Array;
    offscreenPng: Uint8Array;
    metadata: VisualCaptureMetadata;
    release(): void;
  }

  interface VisualCaptureError extends Error {
    readonly visualCaptureFailure: VisualCaptureFailure;
  }

  interface VisualCaptureController {
    capture(): Promise<VisualCaptureLease>;
  }

  interface CompanionDeveloperRuntime {
    readonly status: "installed";
    readonly buildId: number;
    readonly programId: number;
    readonly companionAbi: number;
    readonly kernelSha256: string;
    readonly installation: number;
    readonly hertz: number;
    readonly lastRenderUs: number;
    readonly renderP95Us: number;
    readonly snapshotReads: number;
    readonly rejectedSnapshots: number;
    readonly cursorRefreshes: number;
    readonly cursorHiddenRetests: number;
    readonly cursorHiddenGapMs: number | null;
    readonly wasmMemoryBytes: number;
    readonly cursor: Readonly<{
      generation: number;
      pixelHash: number;
      hidden: boolean;
      valid: boolean;
      cssLength: number;
    }> | null;
    readonly readout: Readonly<{ visible: boolean; line: string }> | null;
    readonly toolbox: ToolboxObservation | null;
    readonly xunlaiAccess: boolean | null;
  }

  interface CompanionObserverRuntime extends CompanionDeveloperRuntime {
    setHookEnabledForBenchmark(enabled: boolean): void;
  }

  type PreGameState = "unknown" | "character-select" | "reconnect" | "loading";

  interface PreGameControls {
    state(): PreGameState;
    playable(): "outpost" | "explorable" | null;
    diagnosticMask(): number;
  }

  interface EnhancementAutomation {
    set(stage: string): void;
    read(): Readonly<{
      stage: string;
      sequence: number;
      transitions: ReadonlyArray<{
        sequence: number;
        stage: string;
        atMs: number;
      }>;
      enhancementStatus: string;
      tickCount: number;
    }>;
  }

  interface Window {
    readonly gwNative: RendererGwNativeApi;
    FS?: {
      syncfs(
        populate: boolean,
        callback: (error?: unknown) => void,
      ): void;
    };
    Module?: {
      canvas?: HTMLCanvasElement & { offscreen?: OffscreenCanvas };
      oskActiveInput?: EventTarget | null;
    };
    gwApplySettings?(settings: AppSettings): void;
    gwCartographyGridStats?(): CartographyGridStats;
    gwSurfaces: GwonmacSurfaceController;
    gwToolsSettings(): Readonly<{
      dictationEnabled?: boolean;
      gwonmacTools: boolean;
      buildLibrary: boolean;
      tradeChat: boolean;
      xunlaiStorage: boolean;
      travelPalette: boolean;
      targetReadout: boolean;
      cartographyOverlayEnabled: boolean;
      cartographyGridEnabled: boolean;
      skillKeyBindings: AppSettings['skillKeyBindings'];
      skillKeyLabelsEnabled: boolean;
      skillCooldownOverlayEnabled: boolean;
      skillCooldownColor: AppSettings['skillCooldownColor'];
    }>;
    gwLoading: LoadingController;
    gwDiagnostics: RendererDiagnostics;
    gwVisualCapture?: VisualCaptureController;
    gwSnapshotState?(): Partial<RendererMetrics>;
    /** Current WASM linear-memory size; present once the client is hosted. */
    gwWasmHeapBytes?(): number;
    /** Bounded texture counters for local developer diagnostics. */
    gwTextureStats?(): TextureMemorySnapshot;
    /** Bounded atlas-sized upload fingerprints; unpackaged development only. */
    gwControllerPromptTextureStats?(): ControllerPromptTextureStats;
    /** Fixed scalar pathing sample; unpackaged development spike only. */
    gwPathingSpike?: PathingSpikeController;
    /** Certified native Compass frame scalars; unpackaged development spike only. */
    gwCompassFrameSpike?: CompassFrameSpikeController;
    /** Certified native Mission Map frame scalars; unpackaged development spike only. */
    gwMissionMapFrameSpike?: MissionMapFrameSpikeController;
    gwWorldMapAnchorSpike?: WorldMapAnchorSpikeController;
    /** Certified exploration bitmap dimensions and bounded bit reader; development only. */
    gwExplorationSpike?: ExplorationSpikeController;
    /** Unpackaged-development controller used to exercise Guild Wars' real gamepad UI. */
    gwVirtualGamepad?: VirtualGamepadController;
    gwResolveClientCompatibility(): Promise<void>;
    gwLog(visible?: boolean): boolean;
    gwEvictMemory(): number;
    gwStats?(): Record<string, number | boolean>;
    gwBuildInfo?: Readonly<{
      programId: number;
      buildId: number;
    }>;
    gwCompanionRuntime?: CompanionDeveloperRuntime | CompanionObserverRuntime | null;
    gwPreGameControls?: PreGameControls | null;
    gwCompanionState?: PublishedCompanionState;
    /** The cursor's bounded presentation state; present once the nativeCursor enhancement installs. */
    gwCursorState?(): Readonly<{
      generation: number;
      pixelHash: number;
      hidden: boolean;
      valid: boolean;
      cssLength: number;
    }> | null;
    gwAutomation: EnhancementAutomation;
    gwGlRecon?(): Readonly<{
      livePrograms: number;
      passThrough: Record<string, number>;
    }>;
    gwTemplateFilesystemTrace?(): ReadonlyArray<Readonly<{
      sequence: number;
      operation: string;
      kind?: "skills" | "equipment";
      fd?: number;
      errno?: number;
      requested?: number;
      written?: number;
    }>>;
  }
}

export {};
