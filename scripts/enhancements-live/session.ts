import type { Page } from "playwright";

export type LiveTier = "automation" | "observation";

export type LoginCheckpoint = Readonly<{
  atMs: number;
  reason: "initial" | "frontend" | "before-input" | "after-input" | "playable";
  input: number;
  progress: string;
  stage: string | null;
  enhancementStatus: string;
  tickCount: number;
  canvasReady: boolean;
  loadingVisible: boolean;
}>;

export type PlayableBootstrap = Readonly<{
  inputs: number;
  checkpoints: ReadonlyArray<LoginCheckpoint>;
}>;

async function readLoginCheckpoint(
  page: Page,
  startedAt: number,
  reason: LoginCheckpoint["reason"],
  input: number,
): Promise<LoginCheckpoint> {
  return page.evaluate(
    ({ at, why, attempt }) => {
      const lifecycle = window.gwAutomation?.read();
      const loading = globalThis.document.getElementById("loading");
      const canvas = globalThis.document.getElementById("canvas");
      const loadingVisible =
        loading !== null &&
        globalThis.getComputedStyle(loading).display !== "none" &&
        !loading.classList.contains("gone");
      const bounds = canvas?.getBoundingClientRect();
      const canvasReady =
        canvas !== null &&
        !loadingVisible &&
        (bounds?.width ?? 0) > 0 &&
        (bounds?.height ?? 0) > 0;
      return {
        atMs: Math.max(0, Math.round(performance.now() - at)),
        reason: why,
        input: attempt,
        progress: "ready",
        stage: lifecycle?.stage ?? null,
        enhancementStatus:
          lifecycle?.enhancementStatus ??
          window.gwCompanionState?.status ??
          "not-installed",
        tickCount:
          lifecycle?.tickCount ??
          Number(window.gwCompanionState?.tickCount ?? 0),
        canvasReady,
        loadingVisible,
      };
    },
    { at: startedAt, why: reason, attempt: input },
  );
}

function isPlayable(checkpoint: LoginCheckpoint): boolean {
  return checkpoint.enhancementStatus === "ready" && checkpoint.tickCount > 5;
}

function isFrontend(checkpoint: LoginCheckpoint): boolean {
  return (
    checkpoint.canvasReady ||
    checkpoint.stage === "client.frontend" ||
    checkpoint.stage?.startsWith("game.") === true
  );
}

/**
 * Drives saved-login and character entry. It records independent visual and
 * enhancement signals because reaching the world and installing the companion
 * are separate outcomes even when a scenario requires both.
 */
export async function waitForPlayable(
  page: Page,
  tier: LiveTier,
): Promise<PlayableBootstrap> {
  await page.waitForFunction(
    async () => {
      const progress = await window.gwNative.progress.current();
      if (progress.phase === "error") throw new Error(progress.errorCode);
      return progress.phase === "ready";
    },
    null,
    { timeout: 30 * 60_000, polling: 500 },
  );
  const startedAt = await page.evaluate(() => performance.now());
  const checkpoints: LoginCheckpoint[] = [];
  const record = async (
    reason: LoginCheckpoint["reason"],
    input: number,
  ) => {
    const checkpoint = await readLoginCheckpoint(
      page,
      startedAt,
      reason,
      input,
    );
    checkpoints.push(checkpoint);
    console.log(JSON.stringify({ checkpoint: "login", ...checkpoint }));
    return checkpoint;
  };
  let current = await record("initial", 0);

  if (tier === "automation") {
    for (
      let elapsed = 0;
      !isFrontend(current) && elapsed < 60_000;
      elapsed += 250
    ) {
      await page.waitForTimeout(250);
      current = await readLoginCheckpoint(page, startedAt, "frontend", 0);
    }
    current = await record("frontend", 0);
    if (!isFrontend(current)) {
      throw new Error(
        `login frontend unavailable: ${JSON.stringify({ checkpoints })}`,
      );
    }
    if (current.enhancementStatus === "unsupported") {
      throw new Error(
        `login readback unsupported: ${JSON.stringify({ checkpoints })}`,
      );
    }

    let inputs = 0;
    for (const delay of [3_000, 5_000, 20_000, 20_000]) {
      if (isPlayable(current)) break;
      await page.waitForTimeout(delay);
      current = await record("before-input", inputs);
      if (isPlayable(current)) break;
      if (current.stage === "game.loading") continue;
      if (current.enhancementStatus === "unsupported") {
        throw new Error(
          `login readback unsupported: ${JSON.stringify({ checkpoints })}`,
        );
      }
      await page.locator("#canvas").focus();
      await page.keyboard.press("Enter");
      inputs += 1;
      current = await record("after-input", inputs);
    }
    for (
      let elapsed = 0;
      !isPlayable(current) && elapsed < 60_000;
      elapsed += 250
    ) {
      await page.waitForTimeout(250);
      current = await readLoginCheckpoint(
        page,
        startedAt,
        "playable",
        inputs,
      );
    }
    current = await record("playable", inputs);
    if (!isPlayable(current)) {
      throw new Error(
        `automatic login did not reach a playable character: ${
          JSON.stringify({ inputs, checkpoints })
        }`,
      );
    }
    return Object.freeze({
      inputs,
      checkpoints: Object.freeze(checkpoints.slice()),
    });
  }

  const cursorReady = () =>
    page.evaluate(() => {
      const cursor = window.gwCompanionRuntime?.cursor;
      return (
        window.gwCompanionRuntime?.status === "installed" &&
        typeof cursor === "object" &&
        cursor !== null &&
        "valid" in cursor &&
        cursor.valid === true
      );
    });
  if (!(await cursorReady())) {
    console.log(
      JSON.stringify({
        checkpoint: "waiting-for-enhancement",
        please: "bring the client to a playable character",
      }),
    );
  }
  await page.waitForFunction(
    () => {
      const cursor = window.gwCompanionRuntime?.cursor;
      const cursorValid =
        typeof cursor === "object" &&
        cursor !== null &&
        "valid" in cursor &&
        cursor.valid === true;
      return window.gwCompanionRuntime?.status === "installed" && cursorValid;
    },
    null,
    { timeout: 30 * 60_000, polling: 250 },
  );
  await record("playable", 0);
  return Object.freeze({
    inputs: 0,
    checkpoints: Object.freeze(checkpoints.slice()),
  });
}
