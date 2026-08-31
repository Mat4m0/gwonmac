import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { Page } from "playwright";
import { projectLiveResult } from "./result.js";

export type GraphicsProbeSample = Readonly<{
  capturedAt: string;
  rendererNowMs: number;
  visible: boolean;
  focused: boolean;
  devicePixelRatio: number;
  canvas: Readonly<{
    cssWidth: number;
    cssHeight: number;
    width: number;
    height: number;
    offscreenWidth: number;
    offscreenHeight: number;
    context: string;
    contextLost: boolean | null;
    drawingBufferWidth: number;
    drawingBufferHeight: number;
  }>;
  wasmHeapBytes: number;
  textures: ReturnType<NonNullable<Window["gwTextureStats"]>> | null;
  cartographyGrid: ReturnType<NonNullable<Window["gwCartographyGridStats"]>> | null;
  cartographyModel: ReturnType<NonNullable<Window["gwCartographyModelStats"]>> | null;
  compassFrame: ReturnType<NonNullable<Window["gwCompassFrameSpike"]>["snapshot"]> | null;
  missionMapFrame: ReturnType<NonNullable<Window["gwMissionMapFrameSpike"]>["snapshot"]> | null;
  worldMapFrame: ReturnType<NonNullable<Window["gwWorldMapFrameSpike"]>["diagnostics"]> | null;
  worldMapAnchor: ReturnType<NonNullable<Window["gwWorldMapAnchorSpike"]>["snapshot"]> | null;
  exploration: Readonly<{
    snapshot: ReturnType<NonNullable<Window["gwExplorationSpike"]>["snapshot"]>;
    cellX: number | null;
    cellY: number | null;
    neighborhood: readonly Readonly<{ x: number; y: number; explored: boolean | null }>[];
  }> | null;
  companion: Readonly<{
    status: string;
    mapId: number | null;
    instanceName: string | null;
    playerX: number | null;
    playerY: number | null;
    sequence: number | null;
  }> | null;
  images: Record<string, number | boolean> | null;
  programs: ReturnType<NonNullable<Window["gwGlRecon"]>> | null;
  lifecycle: ReturnType<Window["gwAutomation"]["read"]> | null;
  diagnostics: Awaited<ReturnType<Window["gwNative"]["diagnostics"]["current"]>>;
}>;

export type GraphicsProbeEvidence = Readonly<{
  baseline: GraphicsProbeSample;
  captures: ReadonlyArray<Readonly<{
    label: string;
    screenshot: string;
    sample: GraphicsProbeSample;
  }>>;
}>;

type GraphicsProbeSession = Readonly<{
  evidence: GraphicsProbeEvidence;
  finalProjection: Awaited<ReturnType<typeof projectLiveResult>> | null;
  windowClosed: boolean;
}>;

function readGraphicsProjection(page: Page): Promise<GraphicsProbeSample> {
  return page.evaluate(async (): Promise<GraphicsProbeSample> => {
    const canvas = document.getElementById("canvas");
    const visible = canvas instanceof HTMLCanvasElement ? canvas : null;
    const offscreen = window.Module?.canvas === visible
      ? window.Module.canvas.offscreen
      : undefined;
    const gl = offscreen?.getContext("webgl2")
      ?? offscreen?.getContext("webgl")
      ?? null;
    const companion = window.gwCompanionState;
    const missionMapFrame = window.gwMissionMapFrameSpike?.snapshot() ?? null;
    const explorationSnapshot = window.gwExplorationSpike?.snapshot() ?? null;
    const explorationCellX = missionMapFrame === null
      ? null
      : Math.floor(missionMapFrame.playerMapX / 32);
    const explorationCellY = missionMapFrame === null
      ? null
      : Math.floor(missionMapFrame.playerMapY / 32);
    const explorationNeighborhood = explorationCellX === null || explorationCellY === null
      ? []
      : Array.from({ length: 25 }, (_, index) => {
          const x = explorationCellX + index % 5 - 2;
          const y = explorationCellY + Math.floor(index / 5) - 2;
          return { x, y, explored: window.gwExplorationSpike?.isExplored(x, y) ?? null };
        });
    return {
      capturedAt: new Date().toISOString(),
      rendererNowMs: performance.now(),
      visible: !document.hidden,
      focused: document.hasFocus(),
      devicePixelRatio: window.devicePixelRatio || 1,
      canvas: {
        cssWidth: visible?.clientWidth ?? 0,
        cssHeight: visible?.clientHeight ?? 0,
        width: visible?.width ?? 0,
        height: visible?.height ?? 0,
        offscreenWidth: offscreen?.width ?? 0,
        offscreenHeight: offscreen?.height ?? 0,
        context: gl?.constructor?.name ?? "none",
        contextLost: gl ? gl.isContextLost() : null,
        drawingBufferWidth: gl?.drawingBufferWidth ?? 0,
        drawingBufferHeight: gl?.drawingBufferHeight ?? 0,
      },
      wasmHeapBytes: window.gwWasmHeapBytes?.() ?? 0,
      textures: window.gwTextureStats?.() ?? null,
      cartographyGrid: window.gwCartographyGridStats?.() ?? null,
      cartographyModel: window.gwCartographyModelStats?.() ?? null,
      compassFrame: window.gwCompassFrameSpike?.snapshot() ?? null,
      missionMapFrame,
      worldMapFrame: window.gwWorldMapFrameSpike?.diagnostics() ?? null,
      worldMapAnchor: window.gwWorldMapAnchorSpike?.snapshot() ?? null,
      exploration: explorationSnapshot === null ? null : {
        snapshot: explorationSnapshot,
        cellX: explorationCellX,
        cellY: explorationCellY,
        neighborhood: explorationNeighborhood,
      },
      companion: companion === undefined ? null : {
        status: companion.status,
        mapId: companion.status === "ready" ? companion.mapId : null,
        instanceName: companion.status === "ready" ? companion.instanceName : null,
        playerX: companion.status === "ready" ? companion.playerX : null,
        playerY: companion.status === "ready" ? companion.playerY : null,
        sequence: "sequence" in companion ? companion.sequence ?? null : null,
      },
      images: typeof window.gwStats === "function" ? window.gwStats() : null,
      programs: window.gwGlRecon?.() ?? null,
      lifecycle: window.gwAutomation?.read() ?? null,
      diagnostics: await window.gwNative.diagnostics.current(),
    };
  });
}

async function finalProjection(
  page: Page,
  cadence: { ticks: number; elapsedMs: number },
) {
  if (page.isClosed()) return null;
  try {
    return await projectLiveResult(page, cadence, "graphics-probe");
  } catch (error) {
    if (page.isClosed()) return null;
    throw error;
  }
}

/**
 * Runs the complete operator-owned graphics investigation. Keeping projection,
 * capture persistence, and close handling together prevents graphics-only
 * branches and screenshot capabilities from leaking into ordinary scenarios.
 */
export async function runGraphicsProbeSession({
  page,
  repositoryRoot,
  cadence,
}: {
  page: Page;
  repositoryRoot: string;
  cadence: { ticks: number; elapsedMs: number };
}): Promise<GraphicsProbeSession> {
  const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const outputDir = path.join(
    repositoryRoot,
    "test-results",
    "graphics-live",
    runId,
  );
  let captureCount = 0;
  const cartographyCalibration = process.env.GW_CARTOGRAPHY_LIVE === "1";
  const baseline = await readGraphicsProjection(page);
  const captures: Array<{
    label: string;
    screenshot: string;
    sample: GraphicsProbeSample;
  }> = [];

  console.log(`Graphics evidence directory: ${outputDir}`);
  console.log(JSON.stringify({
    checkpoint: "graphics-probe-ready",
    please: "follow the named Mission Map matrix; wait one second after each visual change before capture",
    suggestedSequence: cartographyCalibration
      ? [
          "capture maps-closed",
          "capture compass-idle-1",
          "capture compass-idle-2",
          "capture compass-grid-default",
          "capture compass-walk-same-cell",
          "capture compass-cross-cell",
          "capture compass-rotated",
          "capture mission-default",
          "capture mission-pan-horizontal",
          "capture mission-pan-vertical",
          "capture mission-zoom-min",
          "capture mission-zoom-max",
          "capture mission-window-moved",
          "capture mission-window-resized",
          "capture mission-reopened",
          "capture layers-grid-only",
          "capture layers-walkability-only",
          "capture layers-all",
          "capture district-transition",
          "capture different-map",
          "reset-context",
          "capture context-restored",
        ]
      : ["capture baseline", "capture changed-state", "reset-context", "capture context-restored"],
    privacy: "each capture saves the visible game window; JSON retains bounded scalar diagnostics, never texture pixels or WASM pointers",
  }));

  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for await (const line of input) {
      const command = line.trim().toLowerCase();
      if (command === "q" || command === "quit") break;
      if (command === "reset-context") {
        const reset = await page.evaluate(() => {
          const canvas = document.getElementById("canvas");
          const visible = canvas instanceof HTMLCanvasElement ? canvas : null;
          const offscreen = window.Module?.canvas === visible
            ? window.Module.canvas.offscreen
            : undefined;
          const gl = offscreen?.getContext("webgl2") ?? offscreen?.getContext("webgl") ?? null;
          const extension = gl?.getExtension("WEBGL_lose_context") ?? null;
          if (!extension) return false;
          extension.loseContext();
          setTimeout(() => extension.restoreContext(), 500);
          return true;
        });
        await page.waitForTimeout(1_500);
        console.log(JSON.stringify({
          checkpoint: "graphics-context-reset",
          outcome: reset ? "requested" : "unavailable",
          please: reset ? "capture context-restored" : "continue without context-reset evidence",
        }));
        continue;
      }
      const requestedLabel = command.startsWith("capture ")
        ? command.slice("capture ".length).trim()
        : command === "" || command === "c" || command === "capture"
          ? `state-${captureCount + 1}`
          : "";
      const label = requestedLabel.replaceAll(/[^a-z0-9-]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 48);
      if (!label) {
        console.log("Type capture <label>, reset-context, or q to finish.");
        continue;
      }

      const sample = await readGraphicsProjection(page);
      await mkdir(outputDir, { recursive: true });
      captureCount += 1;
      const stem = `capture-${String(captureCount).padStart(3, "0")}-${label}`;
      const screenshot = `${stem}.png`;
      const screenshotBytes = await page.screenshot();
      await writeFile(path.join(outputDir, screenshot), screenshotBytes);
      await writeFile(
        path.join(outputDir, `${stem}.json`),
        JSON.stringify(sample, null, 2),
      );
      captures.push({ label, screenshot, sample });
      console.log(JSON.stringify({
        checkpoint: "graphics-captured",
        capture: captures.length,
        label,
        screenshot,
        textureBytes: sample.textures?.knownTextureBytes ?? null,
        liveTextures: sample.textures?.liveTextures ?? null,
        wasmHeapBytes: sample.wasmHeapBytes,
        contextLost: sample.canvas.contextLost,
        cartographyGrid: sample.cartographyGrid,
        exploration: sample.exploration,
        cartographyModel: sample.cartographyModel,
      }));
    }
  } finally {
    input.close();
  }

  const evidence = { baseline, captures } satisfies GraphicsProbeEvidence;
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  const projection = await finalProjection(page, cadence);
  return {
    evidence,
    finalProjection: projection,
    windowClosed: projection === null,
  };
}
