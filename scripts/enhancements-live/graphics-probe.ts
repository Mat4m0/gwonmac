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
  images: Record<string, number | boolean> | null;
  programs: ReturnType<NonNullable<Window["gwGlRecon"]>> | null;
  lifecycle: ReturnType<Window["gwAutomation"]["read"]> | null;
  diagnostics: Awaited<ReturnType<Window["gwNative"]["diagnostics"]["current"]>>;
}>;

export type GraphicsProbeEvidence = Readonly<{
  baseline: GraphicsProbeSample;
  captures: ReadonlyArray<Readonly<{
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
  const baseline = await readGraphicsProjection(page);
  const captures: Array<{
    screenshot: string;
    sample: GraphicsProbeSample;
  }> = [];

  console.log(`Graphics evidence directory: ${outputDir}`);
  console.log(JSON.stringify({
    checkpoint: "graphics-probe-ready",
    please: "play normally; press Enter to capture evidence, or type q then Enter to finish",
    privacy: "a capture saves the visible game window as a local screenshot",
  }));

  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for await (const line of input) {
      const command = line.trim().toLowerCase();
      if (command === "q" || command === "quit") break;
      if (command !== "" && command !== "c" && command !== "capture") {
        console.log("Press Enter to capture, or type q then Enter to finish.");
        continue;
      }

      const sample = await readGraphicsProjection(page);
      await mkdir(outputDir, { recursive: true });
      captureCount += 1;
      const stem = `capture-${String(captureCount).padStart(3, "0")}`;
      const screenshot = `${stem}.png`;
      await page.screenshot({ path: path.join(outputDir, screenshot) });
      await writeFile(
        path.join(outputDir, `${stem}.json`),
        JSON.stringify(sample, null, 2),
      );
      captures.push({ screenshot, sample });
      console.log(JSON.stringify({
        checkpoint: "graphics-captured",
        capture: captures.length,
        screenshot,
        textureBytes: sample.textures?.knownTextureBytes ?? null,
        liveTextures: sample.textures?.liveTextures ?? null,
        wasmHeapBytes: sample.wasmHeapBytes,
        contextLost: sample.canvas.contextLost,
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
