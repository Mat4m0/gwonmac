import type {
  AppSettings,
  AppSettingsPatch,
  GwNativeApi,
  EnhancementSelection,
} from "../shared/contracts.js";
import type {
  RendererEventName,
  RendererMetrics,
} from "../shared/diagnostics.js";

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
  interface GameInputDiagnostics {
    event(name: string, value?: unknown): void;
  }

  interface GameInputController {
    releaseAll(): void;
  }

  interface LoadingController {
    set(message: string, fraction: number | null, detail?: string): void;
    fail(message: string, detail?: string): void;
    failFilesystem(): void;
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

  interface CompanionState {
    status?: string;
    reason?: string;
    instanceType?: number;
    tickCount?: number;
    [key: string]: unknown;
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
    readonly wasmMemoryBytes: number;
    readonly cursor: Readonly<{
      generation: number;
      pixelHash: number;
      hidden: boolean;
      valid: boolean;
      cssLength: number;
    }> | null;
    readonly readout: Readonly<{ visible: boolean; line: string }> | null;
    readonly toolbox: Readonly<{
      status: string;
      playerChatCount?: number;
      cursorEventCount?: number;
      heroAvailable?: boolean;
      heroCount?: number;
      firstHeroId?: number;
      firstHeroAgentId?: number;
      panelState?: number;
    }> | null;
  }

  interface CompanionObserverRuntime extends CompanionDeveloperRuntime {
    setHookEnabledForBenchmark(enabled: boolean): void;
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

  interface EnhancementSettingsController {
    patchFor(control: HTMLInputElement | HTMLSelectElement): AppSettingsPatch | null;
    render(settings: AppSettings): void;
    resultFor(
      control: HTMLInputElement | HTMLSelectElement,
      patch: AppSettingsPatch,
      saved: AppSettings,
    ): Readonly<{ applied: boolean; text: string }> | null;
  }

  interface Window {
    readonly gwNative: GwNativeApi;
    Module?: {
      FS?: {
        syncfs(
          populate: boolean,
          callback: (error?: unknown) => void,
        ): void;
      };
      canvas?: {
        offscreen?: { width: number; height: number };
      };
    };
    gwApplySettings?(settings: AppSettings): void;
    gwLoading: LoadingController;
    gwDiagnostics: RendererDiagnostics;
    gwSnapshotState?(): Partial<RendererMetrics>;
    gwResolveDataStrategy(snapshotBytes: number): Promise<void>;
    gwLog(visible?: boolean): boolean;
    gwEvictMemory(): number;
    gwStats(): Record<string, number | boolean>;
    gwBuildInfo?: Readonly<{
      programId: number;
      buildId: number;
    }>;
    gwCompanionRuntime?: CompanionDeveloperRuntime | CompanionObserverRuntime | null;
    gwCompanionState?: CompanionState;
    readonly gwEnhancementSettings: Readonly<{
      create(options: {
        form: HTMLFormElement;
        selection: EnhancementSelection;
      }): EnhancementSettingsController;
    }>;
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
