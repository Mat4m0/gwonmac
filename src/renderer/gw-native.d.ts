import type { GwNativeApi } from "../shared/contracts.js";
import type {
  RendererEventName,
  RendererMetrics,
} from "../shared/diagnostics.js";

declare global {
  interface GameInputDiagnostics {
    event(name: string, value?: unknown): void;
  }

  interface GameInputController {
    releaseAll(): void;
    applySettings(settings: AppSettings): void;
  }

  interface LoadingController {
    set(message: string, fraction: number | null, detail?: string): void;
    fail(message: string): void;
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
    mark(name: string, fields?: unknown): void;
    event(name: RendererEventName, value?: unknown): void;
    snapshot(
      durationUs: number,
      bytes: number,
      source: "memory" | "native",
    ): void;
    cache(source: "memory" | "native" | "coalesced"): void;
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

  interface Window {
    readonly gwNative: GwNativeApi;
    Module?: {
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
    gwInstallGraphics(options: {
      env: ArenaNetEglImports;
      module: ArenaNetGraphicsModule;
      renderScale(): 1 | 1.5 | 2;
      firstFrame(): void;
      log(...values: unknown[]): void;
    }): void;
    gwInstallGameFilesystem(options: {
      module: {
        addRunDependency(name: string): void;
        removeRunDependency(name: string): void;
        preRun?: () => void;
      };
      failed(error: unknown): void;
      log(...values: unknown[]): void;
    }): void;
    gwInstallGameInput(options: {
      canvas: HTMLCanvasElement;
      initialSettings: AppSettings;
      diagnostics?: GameInputDiagnostics;
      log(...values: unknown[]): void;
    }): GameInputController;
  }
}

export {};
