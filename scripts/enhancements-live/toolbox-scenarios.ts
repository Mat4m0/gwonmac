import type { Page } from "playwright";
import type { AutomationContext } from "./scenarios.js";
import { operatorCheckpoint } from "./scenario-checkpoint.js";

type ToolboxLiveState = {
  status: string;
  playerChatCount: number;
  cursorEventCount: number;
  cursorRefreshes: number;
  cursorGeneration: number;
  cursorPixelHash: number;
  cursorValid: boolean;
  heroAvailable: boolean;
  firstHeroId: number;
  panelState: number;
  partyReady: boolean;
  rosterObserved: boolean;
  unlockObserved: boolean;
  ownedHeroCount: number;
  completeHeroCount: number;
  playerDetailsObserved: boolean;
};

async function readToolboxState(page: Page): Promise<ToolboxLiveState> {
  return page.evaluate(() => {
    const raw = window.gwCompanionRuntime?.toolbox;
    const value = typeof raw === "object" && raw !== null
      ? raw as Record<string, unknown>
      : {};
    const party = typeof value.party === "object" && value.party !== null
      ? value.party as Record<string, unknown>
      : {};
    const slots = Array.isArray(party.slots)
      ? party.slots.filter((slot): slot is Record<string, unknown> =>
        typeof slot === "object" && slot !== null)
      : [];
    const heroes = slots.filter((slot) =>
      slot.occupied === true && typeof slot.hero === "number");
    const player = slots.find((slot) => slot.occupied === true && slot.hero === null);
    return {
      status: String(value.status ?? "missing"),
      playerChatCount: Number(value.playerChatCount) >>> 0,
      cursorEventCount: Number(value.cursorEventCount) >>> 0,
      cursorRefreshes: Number(window.gwCompanionRuntime?.cursorRefreshes) >>> 0,
      cursorGeneration:
        typeof window.gwCompanionRuntime?.cursor === "object"
          && window.gwCompanionRuntime.cursor !== null
          && "generation" in window.gwCompanionRuntime.cursor
          ? Number(window.gwCompanionRuntime.cursor.generation) >>> 0
          : 0,
      cursorPixelHash:
        typeof window.gwCompanionRuntime?.cursor === "object"
          && window.gwCompanionRuntime.cursor !== null
          && "pixelHash" in window.gwCompanionRuntime.cursor
          ? Number(window.gwCompanionRuntime.cursor.pixelHash) >>> 0
          : 0,
      cursorValid:
        typeof window.gwCompanionRuntime?.cursor === "object"
        && window.gwCompanionRuntime.cursor !== null
        && "valid" in window.gwCompanionRuntime.cursor
        && window.gwCompanionRuntime.cursor.valid === true,
      heroAvailable: value.heroAvailable === true,
      firstHeroId: Number(value.firstHeroId) >>> 0,
      panelState: Number(value.panelState) >>> 0,
      partyReady: party.status === "ready",
      rosterObserved: party.rosterObserved === true,
      unlockObserved: party.unlockObserved === true,
      ownedHeroCount: heroes.length,
      completeHeroCount: heroes.filter((hero) =>
        Array.isArray(hero.professions)
        && Array.isArray(hero.skills)
        && Array.isArray(hero.attributes)
        && typeof hero.behaviour === "number"
      ).length,
      playerDetailsObserved:
        player !== undefined
        && Array.isArray(player.professions)
        && Array.isArray(player.skills)
        && Array.isArray(player.attributes),
    };
  });
}

async function openToolboxOverlay(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open Tools" }).click();
  await page.waitForFunction(() =>
    document.getElementById("toolbox-foundation")?.dataset.open === "true",
  );
}

/**
 * The chord, because the overlay has no close control of its own: it hosts a
 * tool, and the tool owns its own window furniture.
 */
async function closeToolboxOverlay(page: Page): Promise<void> {
  await page.keyboard.press("Control+Shift+Space");
  await page.waitForFunction(() =>
    document.getElementById("toolbox-foundation")?.dataset.open === "false",
  );
}

export async function runToolboxFoundation({ page }: AutomationContext) {
  await page.waitForFunction(() => {
    const toolbox = window.gwCompanionRuntime?.toolbox;
    return typeof toolbox === "object"
      && toolbox !== null
      && "status" in toolbox
      && toolbox.status === "ready";
  });
  const runtimeSurface = await page.evaluate(() => ({
    frozen: Object.isFrozen(window.gwCompanionRuntime),
    keys: Object.keys(window.gwCompanionRuntime ?? {}).sort(),
  }));
  const expectedRuntimeKeys = [
    "buildId",
    "companionAbi",
    "cursor",
    "cursorRefreshes",
    "hertz",
    "installation",
    "kernelSha256",
    "lastRenderUs",
    "programId",
    "readout",
    "rejectedSnapshots",
    "renderP95Us",
    "snapshotReads",
    "status",
    "toolbox",
    "wasmMemoryBytes",
  ].sort();
  if (
    !runtimeSurface.frozen
    || JSON.stringify(runtimeSurface.keys) !== JSON.stringify(expectedRuntimeKeys)
  ) {
    throw new Error("Toolbox published a mutable or over-broad developer surface");
  }
  const baseline = await readToolboxState(page);
  await page.waitForTimeout(5_000);
  const quiet = await readToolboxState(page);
  if (quiet.playerChatCount !== baseline.playerChatCount) {
    throw new Error("player chat count changed during the quiet baseline");
  }

  await operatorCheckpoint(
    "open the inventory, place the pointer over a salvage kit without clicking it, then return here using only the keyboard",
  );
  const cursorBefore = await readToolboxState(page);
  if (!cursorBefore.cursorValid) {
    throw new Error("the game cursor was not published before the click proof");
  }
  console.log(JSON.stringify({
    checkpoint: "operator-timed",
    please:
      "within 10 seconds, switch back using only the keyboard and activate the salvage kit without moving the pointer",
  }));
  const cursorDeadline = Date.now() + 10_000;
  let cursorAfter = cursorBefore;
  while (
    Date.now() < cursorDeadline
    && cursorAfter.cursorRefreshes === cursorBefore.cursorRefreshes
  ) {
    await page.waitForTimeout(25);
    cursorAfter = await readToolboxState(page);
  }
  // A double-click may schedule two bounded refreshes. Let both mouse releases
  // and the following game tick settle before comparing the final publication.
  await page.waitForTimeout(1_000);
  cursorAfter = await readToolboxState(page);
  if (
    cursorAfter.cursorRefreshes <= cursorBefore.cursorRefreshes
    || cursorAfter.cursorEventCount <= cursorBefore.cursorEventCount
    || cursorAfter.cursorGeneration <= cursorBefore.cursorGeneration
    || cursorAfter.cursorPixelHash === cursorBefore.cursorPixelHash
    || !cursorAfter.cursorValid
  ) {
    throw new Error("the zero-distance click did not publish the salvage cursor");
  }

  await operatorCheckpoint(
    "have a second player send exactly one team/group message",
  );
  await page.waitForFunction(
    (expected) => {
      const toolbox = window.gwCompanionRuntime?.toolbox;
      return typeof toolbox === "object"
        && toolbox !== null
        && "playerChatCount" in toolbox
        && Number(toolbox.playerChatCount) === expected;
    },
    quiet.playerChatCount + 1,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(1_500);
  const afterChat = await readToolboxState(page);
  if (afterChat.playerChatCount !== quiet.playerChatCount + 1) {
    throw new Error("one player chat event did not settle at exactly one increment");
  }

  await operatorCheckpoint("enter /age in Guild Wars and wait for its response");
  await page.waitForTimeout(1_000);
  const afterAge = await readToolboxState(page);
  if (afterAge.playerChatCount !== afterChat.playerChatCount) {
    throw new Error("the non-player /age response incremented player chat");
  }
  if (!afterAge.heroAvailable || afterAge.firstHeroId === 0) {
    throw new Error("no first owned hero is available for the panel proof");
  }
  if (
    !afterAge.partyReady
    || !afterAge.rosterObserved
    || !afterAge.unlockObserved
    || !afterAge.playerDetailsObserved
    || afterAge.ownedHeroCount !== afterAge.completeHeroCount
    || afterAge.ownedHeroCount === 0
  ) {
    throw new Error(
      "the full party, professions, skill bars, attributes, behaviour, or hero unlocks were not observed",
    );
  }

  await operatorCheckpoint(
    "using only Guild Wars' own controls, show the first owned hero's panel",
  );
  await page.waitForFunction(() => {
    const toolbox = window.gwCompanionRuntime?.toolbox;
    return typeof toolbox === "object"
      && toolbox !== null
      && "panelState" in toolbox
      && toolbox.panelState === 2;
  }, undefined, { timeout: 1_000 });
  await operatorCheckpoint(
    "using only Guild Wars' own controls, hide the first owned hero's panel",
  );
  await page.waitForFunction(() => {
    const toolbox = window.gwCompanionRuntime?.toolbox;
    return typeof toolbox === "object"
      && toolbox !== null
      && "panelState" in toolbox
      && toolbox.panelState === 1;
  }, undefined, { timeout: 1_000 });
  // The overlay draws no state of its own any more, so opening it proves the
  // chrome still works over a live client; the panel state was just asserted
  // through the projection above, which is where it actually lives.
  await openToolboxOverlay(page);
  await closeToolboxOverlay(page);
  const final = await readToolboxState(page);
  return {
    baseline: baseline.playerChatCount,
    final: final.playerChatCount,
    delta: final.playerChatCount - baseline.playerChatCount,
    heroId: final.firstHeroId,
    panelState: final.panelState,
    cursorEventDelta:
      cursorAfter.cursorEventCount - cursorBefore.cursorEventCount,
    cursorGenerationDelta:
      cursorAfter.cursorGeneration - cursorBefore.cursorGeneration,
    cursorRefreshDelta:
      cursorAfter.cursorRefreshes - cursorBefore.cursorRefreshes,
    cursorChanged:
      cursorAfter.cursorPixelHash !== cursorBefore.cursorPixelHash,
  };
}

export async function runToolboxHeroPanel({ page }: AutomationContext) {
  await page.waitForFunction(() => {
    const toolbox = window.gwCompanionRuntime?.toolbox;
    return typeof toolbox === "object"
      && toolbox !== null
      && "status" in toolbox
      && toolbox.status === "ready"
      && "heroAvailable" in toolbox
      && toolbox.heroAvailable === true;
  });
  await operatorCheckpoint(
    "confirm a hero is in the party",
  );
  const initial = await readToolboxState(page);
  await operatorCheckpoint(
    "using only Guild Wars' own controls, show the first owned hero's panel",
  );
  await page.waitForFunction(() => {
    const toolbox = window.gwCompanionRuntime?.toolbox;
    return typeof toolbox === "object"
      && toolbox !== null
      && "panelState" in toolbox
      && toolbox.panelState === 2;
  }, undefined, { timeout: 1_000 });
  await operatorCheckpoint(
    "using only Guild Wars' own controls, hide the first owned hero's panel",
  );
  await page.waitForFunction(() => {
    const toolbox = window.gwCompanionRuntime?.toolbox;
    return typeof toolbox === "object"
      && toolbox !== null
      && "panelState" in toolbox
      && toolbox.panelState === 1;
  }, undefined, { timeout: 1_000 });
  // The overlay draws no state of its own any more, so opening it proves the
  // chrome still works over a live client; the panel state was just asserted
  // through the projection above, which is where it actually lives.
  await openToolboxOverlay(page);
  await closeToolboxOverlay(page);
  const final = await readToolboxState(page);
  return {
    heroId: initial.firstHeroId,
    panelState: final.panelState,
  };
}
