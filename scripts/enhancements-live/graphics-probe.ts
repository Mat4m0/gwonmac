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
  textureRecon: ReturnType<NonNullable<Window["gwTextureRecon"]>["checkpoint"]> | null;
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

const MISSION_MAP_TILE_PROOF_FINGERPRINT = "fnv1a32:fcaade3f";

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
      textureRecon: window.gwTextureRecon?.checkpoint() ?? null,
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
  const replacementArmed = await page.evaluate((candidate) => (
    window.gwTextureRecon?.armExactReplacement(candidate) ?? false
  ), MISSION_MAP_TILE_PROOF_FINGERPRINT);
  const baseline = await readGraphicsProjection(page);
  const captures: Array<{
    label: string;
    screenshot: string;
    sample: GraphicsProbeSample;
  }> = [];

  console.log(`Graphics evidence directory: ${outputDir}`);
  console.log(JSON.stringify({
    checkpoint: "graphics-probe-ready",
    please: "keep the Mission Map closed, capture the closed state, open it, then capture the open state",
    exactReplacement: {
      armed: replacementArmed,
      fingerprint: MISSION_MAP_TILE_PROOF_FINGERPRINT,
      expected: "one 512x512 Mission Map tile becomes a magenta/cyan checkerboard",
    },
    suggestedSequence: [
      "capture mission-map-closed",
      "capture mission-map-open",
      "capture mission-map-closed-again",
    ],
    privacy: "each capture saves the visible game window plus bounded texture fingerprints; it saves no pixels from texture memory or WASM pointers",
  }));

  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for await (const line of input) {
      const command = line.trim().toLowerCase();
      if (command === "q" || command === "quit") break;
      const requestedLabel = command.startsWith("capture ")
        ? command.slice("capture ".length).trim()
        : command === "" || command === "c" || command === "capture"
          ? `state-${captureCount + 1}`
          : "";
      const label = requestedLabel.replaceAll(/[^a-z0-9-]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 48);
      if (!label) {
        console.log("Type capture <label>, or q to finish.");
        continue;
      }

      const sample = await readGraphicsProjection(page);
      await mkdir(outputDir, { recursive: true });
      captureCount += 1;
      const stem = `capture-${String(captureCount).padStart(3, "0")}-${label}`;
      const screenshot = `${stem}.png`;
      await page.screenshot({ path: path.join(outputDir, screenshot) });
      await writeFile(
        path.join(outputDir, `${stem}.json`),
        JSON.stringify(sample, null, 2),
      );
      captures.push({ label, screenshot, sample });
      const textureCandidates = sample.textureRecon?.records.slice(0, 12).map((record) => ({
        texture: record.texture,
        size: `${record.width}x${record.height}`,
        fingerprint: record.fingerprint,
        draws: record.intervalDrawUses,
        binds: record.intervalBinds,
        uploads: record.intervalUploads,
      })) ?? [];
      console.log(JSON.stringify({
        checkpoint: "graphics-captured",
        capture: captures.length,
        label,
        screenshot,
        textureBytes: sample.textures?.knownTextureBytes ?? null,
        liveTextures: sample.textures?.liveTextures ?? null,
        wasmHeapBytes: sample.wasmHeapBytes,
        contextLost: sample.canvas.contextLost,
        textureCandidates,
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
