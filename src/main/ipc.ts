import { BrowserWindow, dialog, ipcMain, shell, app, safeStorage } from "electron";
import { writeFile } from "node:fs/promises";
import type {
  AppSettings,
  AppSettingsPatch,
  CacheInfo,
  DownloadProgress,
  ExternalLinkKind,
  GraphicsDiagnostics,
  SocketEvent,
  StoredCredentials,
} from "../shared/contracts.js";
import {
  isRendererFrameBatch,
  isRendererMetrics,
  RENDERER_MILESTONES,
} from "../shared/diagnostics.js";
import { EXTERNAL_URLS, IPC } from "../shared/contracts.js";
import { AllowlistError, AppError, ValidationError } from "../shared/errors.js";
import { CredentialsStore } from "./core/credentials.js";
import { resolveDns } from "./core/dns.js";
import { checkForUpdate } from "./update-check.js";
import { parseSettingsPatch } from "./core/settings.js";
import type { SocketManager } from "./core/sockets.js";
import { buildSnapshotMetadata, snapshotMetadataWire } from "./core/snapshot.js";
import type { ChunkStore } from "./core/chunk-store.js";
import {
  count,
  diagnosticSummary,
  diagnosticTimestampUs,
  exportDiagnosticsForWindow,
  log,
  recordGraphics,
  recordRendererMetrics,
  recordRendererFrames,
  recordRendererMilestone,
  recordClockOffset,
  span,
  startDiagnosticCapture,
  stopDiagnosticCapture,
} from "./diagnostics.js";
import { gamePaths } from "./paths.js";
import { getMainWindow, resetWindowState } from "./window.js";

export interface IpcContext {
  sockets: SocketManager;
  getProgress: () => DownloadProgress;
  getChunkStore: () => ChunkStore | null;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  resetSettings: () => Promise<AppSettings>;
  downloadFullGame: () => Promise<boolean>;
  stopFullDownload: () => void;
  confirmClientHealthy: () => Promise<void>;
}

function assertSender(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== getMainWindow()) {
    throw new AllowlistError("unowned ipc sender");
  }
  const rawUrl = event.senderFrame?.url ?? event.sender.getURL();
  let trusted: boolean;
  try {
    const url = new URL(rawUrl);
    trusted = url.protocol === "gw:" && url.hostname === "app";
  } catch {
    trusted = false;
  }
  if (!trusted) {
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

function logOperationFailure(
  subsystem: "cache" | "settings",
  name: string,
  error: unknown,
): void {
  log(subsystem, "error", name, {
    message: error instanceof Error ? error.message : String(error),
  });
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

  ipcMain.handle(IPC.progressCurrent, (event) => {
    assertSender(event);
    return ctx.getProgress();
  });

  ipcMain.handle(IPC.snapshotMetadata, async (event) => {
    assertSender(event);
    const store = ctx.getChunkStore();
    if (!store) {
      const offlineSize =
        process.env.GW_OFFLINE_SHELL === "1"
          ? Number(process.env.GW_OFFLINE_SNAPSHOT_SIZE ?? 0)
          : 0;
      return snapshotMetadataWire(
        buildSnapshotMetadata({
          size: Number.isSafeInteger(offlineSize) && offlineSize > 0
            ? offlineSize
            : 0,
          chunkSize: 262144,
          chunkHashes: [],
          residentIndices: [],
        }),
      );
    }
    const bits = await store.residentBits();
    return {
      size: store.size,
      chunkSize: store.chunkSize,
      chunkHashes: store.hashes,
      residentBits: Buffer.from(bits).toString("base64"),
    };
  });

  ipcMain.handle(IPC.dnsResolve, async (event, name: unknown) => {
    assertSender(event);
    if (typeof name !== "string") throw new ValidationError("dns name must be a string");
    const lookup = span("dns", "resolve");
    try {
      const address = await resolveDns(name);
      lookup.end({ status: "ok" });
      return address;
    } catch (err) {
      lookup.end(
        { status: "error", message: err instanceof Error ? err.message : String(err) },
        "error",
      );
      throw err;
    }
  });

  ipcMain.handle(IPC.socketConnect, async (event, destination: unknown) => {
    const win = assertSender(event);
    if (typeof destination !== "string") {
      throw new ValidationError("destination must be a string");
    }
    return ctx.sockets.connect(win.webContents.id, destination);
  });

  ipcMain.handle(IPC.socketSend, async (event, socketId: unknown, data: unknown) => {
    const win = assertSender(event);
    if (!Number.isInteger(socketId)) throw new ValidationError("socketId must be an integer");
    if (!(data instanceof Uint8Array) && !ArrayBuffer.isView(data)) {
      throw new ValidationError("data must be a Uint8Array");
    }
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(
            (data as ArrayBufferView).buffer,
            (data as ArrayBufferView).byteOffset,
            (data as ArrayBufferView).byteLength,
          );
    count("socket.ipcReceiveCalls");
    count("socket.ipcPayloadBytes", bytes.byteLength);
    count("socket.ipcBackingBytes", bytes.buffer.byteLength);
    await ctx.sockets.send(socketId as number, bytes, win.webContents.id);
  });

  ipcMain.handle(IPC.socketClose, async (event, socketId: unknown) => {
    const win = assertSender(event);
    if (!Number.isInteger(socketId)) throw new ValidationError("socketId must be an integer");
    await ctx.sockets.close(socketId as number, win.webContents.id);
  });

  ipcMain.handle(IPC.settingsGet, async (event) => {
    assertSender(event);
    try {
      return await ctx.getSettings();
    } catch (error) {
      logOperationFailure("settings", "settings.loadFailed", error);
      throw error;
    }
  });

  ipcMain.handle(IPC.settingsSet, async (event, value: unknown) => {
    assertSender(event);
    try {
      const previous = await ctx.getSettings();
      const saved = await ctx.updateSettings(parseSettingsPatch(value));
      if (previous.dataStrategy !== saved.dataStrategy) {
        log("settings", "info", "launcher.strategyChanged", {
          strategy: saved.dataStrategy ?? "unselected",
        });
      }
      return saved;
    } catch (error) {
      logOperationFailure("settings", "settings.saveFailed", error);
      throw error;
    }
  });

  ipcMain.handle(IPC.settingsReset, async (event) => {
    const win = assertSender(event);
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
      logOperationFailure("settings", "settings.resetFailed", error);
      throw error;
    }
  });

  ipcMain.handle(IPC.credentialsLoad, async (event) => {
    assertSender(event);
    try {
      return await credentials.load();
    } catch (error) {
      if (error instanceof AppError && error.code === "credentials_corrupt") {
        // A previous Keychain-backed ciphertext cannot be opened after the
        // deliberate mock-provider cutover. Remove it once and let the game ask
        // again; never expose ciphertext details to the renderer or recorder.
        await credentials.clear();
        log("credentials", "warn", "credentials.unreadableCleared");
        return null;
      }
      log("credentials", "error", "credentials.loadFailed");
      throw error;
    }
  });

  ipcMain.handle(IPC.credentialsSave, async (event, value: unknown) => {
    assertSender(event);
    try {
      await credentials.save(value as StoredCredentials);
    } catch (error) {
      log("credentials", "error", "credentials.saveFailed");
      throw error;
    }
  });

  ipcMain.handle(IPC.credentialsClear, async (event) => {
    assertSender(event);
    try {
      await credentials.clear();
    } catch (error) {
      log("credentials", "error", "credentials.clearFailed");
      throw error;
    }
  });

  ipcMain.handle(IPC.cacheInfo, async (event) => {
    assertSender(event);
    try {
      return await chunkStoreInfo(ctx.getChunkStore());
    } catch (error) {
      logOperationFailure("cache", "cache.infoFailed", error);
      throw error;
    }
  });

  ipcMain.handle(IPC.cacheClear, async (event) => {
    const win = assertSender(event);
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
      logOperationFailure("cache", "cache.clearRequestFailed", error);
      throw error;
    }
  });

  ipcMain.handle(IPC.cacheDownloadAll, async (event) => {
    assertSender(event);
    return ctx.downloadFullGame();
  });

  ipcMain.handle(IPC.cacheStopDownload, (event) => {
    assertSender(event);
    ctx.stopFullDownload();
  });

  ipcMain.handle(IPC.diagnosticsGraphics, async (event, value: unknown) => {
    assertSender(event);
    if (!isGraphicsDiagnostics(value)) {
      throw new ValidationError("invalid graphics diagnostics");
    }
    recordGraphics(value);
  });

  ipcMain.handle(IPC.diagnosticsClockSync, (event, rendererNowUs: unknown) => {
    assertSender(event);
    if (typeof rendererNowUs !== "number" || !Number.isFinite(rendererNowUs)) {
      throw new ValidationError("invalid renderer clock");
    }
    const mainReceiveUs = diagnosticTimestampUs();
    return { mainReceiveUs, mainSendUs: diagnosticTimestampUs() };
  });

  ipcMain.handle(
    IPC.diagnosticsClockResult,
    (event, offsetUs: unknown, rttUs: unknown) => {
      assertSender(event);
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
      recordClockOffset(offsetUs, rttUs);
    },
  );

  ipcMain.handle(IPC.diagnosticsRendererMetrics, async (event, value: unknown) => {
    assertSender(event);
    if (!isRendererMetrics(value)) {
      throw new ValidationError("invalid renderer diagnostics");
    }
    recordRendererMetrics(value);
  });

  ipcMain.handle(IPC.diagnosticsRendererFrames, async (event, value: unknown) => {
    assertSender(event);
    if (!isRendererFrameBatch(value)) {
      throw new ValidationError("invalid renderer frame batch");
    }
    await recordRendererFrames(value);
  });

  ipcMain.handle(
    IPC.diagnosticsRendererMilestone,
    async (
      event,
      name: unknown,
      rendererTimestampUs: unknown,
      fields: unknown,
    ) => {
      assertSender(event);
      const milestoneFields =
        fields &&
        typeof fields === "object" &&
        !Array.isArray(fields) &&
        (typeof (fields as Record<string, unknown>).programId === "string" ||
          typeof (fields as Record<string, unknown>).programId === "number") &&
        (typeof (fields as Record<string, unknown>).buildId === "string" ||
          typeof (fields as Record<string, unknown>).buildId === "number")
          ? {
              programId: (fields as Record<string, string | number>).programId!,
              buildId: (fields as Record<string, string | number>).buildId!,
            }
          : undefined;
      if (
        typeof name !== "string" ||
        !RENDERER_MILESTONES.includes(
          name as (typeof RENDERER_MILESTONES)[number],
        ) ||
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
              (typeof value === "number" &&
                (!Number.isSafeInteger(value) || value < 0)),
          ))
      ) {
        throw new ValidationError("invalid renderer milestone");
      }
      recordRendererMilestone(
        name as (typeof RENDERER_MILESTONES)[number],
        rendererTimestampUs,
        milestoneFields,
      );
      if (name === "frame.firstSubmit") {
        await ctx.confirmClientHealthy();
      }
    },
  );

  ipcMain.handle(IPC.diagnosticsCurrent, (event) => {
    assertSender(event);
    return diagnosticSummary();
  });

  ipcMain.handle(IPC.diagnosticsStartCapture, async (event, level: unknown) => {
    assertSender(event);
    if (level !== 1 && level !== 2) {
      throw new ValidationError("diagnostics level must be 1 or 2");
    }
    await startDiagnosticCapture(level);
  });

  ipcMain.handle(IPC.diagnosticsStopCapture, async (event) => {
    assertSender(event);
    await stopDiagnosticCapture();
  });

  ipcMain.handle(IPC.diagnosticsExport, async (event) => {
    const win = assertSender(event);
    return exportDiagnosticsForWindow(win);
  });

  ipcMain.handle(IPC.appOpenExternal, async (event, kind: unknown) => {
    assertSender(event);
    if (
      kind !== "github" &&
      kind !== "discord" &&
      kind !== "donate" &&
      kind !== "releases" &&
      kind !== "store"
    ) {
      throw new ValidationError("invalid external link kind");
    }
    await shell.openExternal(EXTERNAL_URLS[kind as ExternalLinkKind]);
  });

  ipcMain.handle(IPC.appRequestQuit, async (event) => {
    assertSender(event);
    app.quit();
  });

  ipcMain.handle(IPC.updateStatus, async (event) => {
    assertSender(event);
    return checkForUpdate();
  });
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
