import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCompanionPolicySource } from "../../src/renderer/companion-policy-source.js";
import type { CompanionPlayRegionState } from "../../src/renderer/companion-play-region-snapshot.js";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.js";

function fixture() {
  const settingsEvents = new EventTarget();
  let settings = { ...DEFAULT_SETTINGS };
  let region: CompanionPlayRegionState = Object.freeze({
    status: "waiting",
    reason: "memory",
  });
  const regionListeners = new Set<(state: CompanionPlayRegionState) => void>();
  let regionUnsubscribes = 0;
  const source = createCompanionPolicySource({
    program: "none",
    readSettings: () => settings,
    settingsEvents,
    readPlayRegion: () => region,
    subscribePlayRegion(listener) {
      regionListeners.add(listener);
      listener(region);
      return () => {
        regionUnsubscribes += 1;
        regionListeners.delete(listener);
      };
    },
  });
  return {
    source,
    settingsEvents,
    setSettings(next: typeof settings) { settings = next; },
    publishRegion(next: CompanionPlayRegionState) {
      region = next;
      for (const listener of regionListeners) listener(next);
    },
    get regionUnsubscribes() { return regionUnsubscribes; },
  };
}

describe("companion policy source", () => {
  it("publishes one canonical launch snapshot", () => {
    const test = fixture();
    const updates: unknown[] = [];
    test.source.subscribe((update) => updates.push(update));

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      reason: "launch",
      snapshot: {
        settings: DEFAULT_SETTINGS,
        playRegion: "unknown",
        playRegionState: { status: "waiting", reason: "memory" },
        policy: {
          characterSwitch: true,
          cartography: false,
          tools: false,
          buildLibrary: false,
          tradeChat: false,
          targetReadout: false,
          teamApply: false,
          xunlaiStorage: false,
          travel: false,
          skillKeyLabels: false,
          skillCooldowns: false,
          chatFilters: false,
          quickItemMove: false,
        },
      },
    });
  });

  it("rereads settings instead of trusting the event payload", () => {
    const test = fixture();
    const updates: Array<{ reason: string; tools: boolean }> = [];
    test.source.subscribe(({ reason, snapshot }) => {
      updates.push({ reason, tools: snapshot.policy.tools });
    });
    test.setSettings({ ...DEFAULT_SETTINGS, gwonmacTools: true });
    test.settingsEvents.dispatchEvent(new CustomEvent("gw:tools-settings", {
      detail: { gwonmacTools: false },
    }));

    assert.deepEqual(updates, [
      { reason: "launch", tools: false },
      { reason: "settings", tools: true },
    ]);
  });

  it("deduplicates equal region values and withdraws policy on waiting", () => {
    const test = fixture();
    const updates: Array<{ reason: string; region: string }> = [];
    test.source.subscribe(({ reason, snapshot }) => {
      updates.push({ reason, region: snapshot.playRegion });
    });
    const pve = Object.freeze({
      status: "ready" as const,
      sequence: 2,
      mapId: 42,
      instanceType: 0,
      playRegion: "pve" as const,
      travelContext: "world" as const,
      characterKey: null,
      unlockedMapWords: null,
      guildHall: false,
      hasGuildHall: false,
    });
    test.publishRegion(pve);
    test.publishRegion({ ...pve, sequence: 4 });
    test.publishRegion(Object.freeze({ status: "waiting", reason: "stale" }));

    assert.deepEqual(updates, [
      { reason: "launch", region: "unknown" },
      { reason: "region", region: "pve" },
      { reason: "region", region: "unknown" },
    ]);
  });

  it("publishes same-map character and unlock changes", () => {
    const test = fixture();
    const keys: Array<string | null> = [];
    const unlocks: Array<number | null> = [];
    test.source.subscribe(({ snapshot }) => {
      if (snapshot.playRegionState.status !== "ready") return;
      keys.push(snapshot.playRegionState.characterKey);
      unlocks.push(snapshot.playRegionState.unlockedMapWords?.[1] ?? null);
    });
    const ready = {
      status: "ready" as const,
      mapId: 55,
      instanceType: 0,
      playRegion: "pve" as const,
      travelContext: "world" as const,
      guildHall: false,
      hasGuildHall: false,
    };
    test.publishRegion(Object.freeze({
      ...ready,
      sequence: 2,
      characterKey: "0123456789abcdef",
      unlockedMapWords: Object.freeze([0, 1]),
    }));
    test.publishRegion(Object.freeze({
      ...ready,
      sequence: 4,
      characterKey: "fedcba9876543210",
      unlockedMapWords: Object.freeze([0, 1]),
    }));
    test.publishRegion(Object.freeze({
      ...ready,
      sequence: 6,
      characterKey: "fedcba9876543210",
      unlockedMapWords: Object.freeze([0, 3]),
    }));

    assert.deepEqual(keys, ["0123456789abcdef", "fedcba9876543210", "fedcba9876543210"]);
    assert.deepEqual(unlocks, [1, 1, 3]);
  });

  it("publishes same-map Guild Hall availability changes", () => {
    const test = fixture();
    const guildStates: Array<[boolean, boolean]> = [];
    test.source.subscribe(({ snapshot }) => {
      if (snapshot.playRegionState.status !== "ready") return;
      guildStates.push([
        snapshot.playRegionState.guildHall,
        snapshot.playRegionState.hasGuildHall,
      ]);
    });
    const ready = {
      status: "ready" as const,
      mapId: 55,
      instanceType: 0,
      playRegion: "pve" as const,
      travelContext: "world" as const,
      characterKey: null,
      unlockedMapWords: null,
    };
    test.publishRegion(Object.freeze({
      ...ready, sequence: 2, guildHall: false, hasGuildHall: false,
    }));
    test.publishRegion(Object.freeze({
      ...ready, sequence: 4, guildHall: false, hasGuildHall: true,
    }));
    test.publishRegion(Object.freeze({
      ...ready, sequence: 6, guildHall: true, hasGuildHall: true,
    }));

    assert.deepEqual(guildStates, [[false, false], [false, true], [true, true]]);
  });

  it("withdraws local Tools only for positively identified active PvP play", () => {
    const test = fixture();
    test.setSettings({ ...DEFAULT_SETTINGS, gwonmacTools: true });
    test.settingsEvents.dispatchEvent(new Event("gw:tools-settings"));
    const tools: boolean[] = [];
    test.source.subscribe(({ snapshot }) => tools.push(snapshot.policy.tools));

    test.publishRegion(Object.freeze({
      status: "ready",
      sequence: 2,
      mapId: 188,
      instanceType: 0,
      playRegion: "pvp",
      travelContext: "world",
      characterKey: null,
      unlockedMapWords: null,
      guildHall: false,
      hasGuildHall: false,
    }));
    test.publishRegion(Object.freeze({ status: "waiting", reason: "loading" }));

    assert.deepEqual(tools, [true, false, true]);
  });

  it("detaches both inputs and stops publication on disposal", () => {
    const test = fixture();
    let publications = 0;
    test.source.subscribe(() => { publications += 1; });
    test.source.dispose();
    test.source.dispose();
    test.setSettings({ ...DEFAULT_SETTINGS, gwonmacTools: true });
    test.settingsEvents.dispatchEvent(new Event("gw:tools-settings"));
    test.publishRegion(Object.freeze({
      status: "ready",
      sequence: 2,
      mapId: 42,
      instanceType: 0,
      playRegion: "pve",
      travelContext: "world",
      characterKey: null,
      unlockedMapWords: null,
      guildHall: false,
      hasGuildHall: false,
    }));

    assert.equal(publications, 1);
    assert.equal(test.regionUnsubscribes, 1);
  });

  it("rolls back a settings listener when region subscription fails", () => {
    const settingsEvents = new EventTarget();
    let settingsReads = 0;
    assert.throws(
      () => createCompanionPolicySource({
        program: "none",
        readSettings() {
          settingsReads += 1;
          return DEFAULT_SETTINGS;
        },
        settingsEvents,
        readPlayRegion: () => ({ status: "waiting", reason: "memory" }),
        subscribePlayRegion() {
          throw new Error("subscription refused");
        },
      }),
      /subscription refused/,
    );
    settingsEvents.dispatchEvent(new Event("gw:tools-settings"));
    assert.equal(settingsReads, 1);
  });

  it("does not retain a subscriber whose launch callback throws", () => {
    const test = fixture();
    let calls = 0;
    assert.throws(
      () => test.source.subscribe(() => {
        calls += 1;
        throw new Error("surface refused launch");
      }),
      /surface refused launch/,
    );
    test.setSettings({ ...DEFAULT_SETTINGS, gwonmacTools: true });
    test.settingsEvents.dispatchEvent(new Event("gw:tools-settings"));
    assert.equal(calls, 1);
  });

  it("stops an individually unsubscribed consumer", () => {
    const test = fixture();
    let calls = 0;
    const unsubscribe = test.source.subscribe(() => { calls += 1; });
    unsubscribe();
    unsubscribe();
    test.setSettings({ ...DEFAULT_SETTINGS, gwonmacTools: true });
    test.settingsEvents.dispatchEvent(new Event("gw:tools-settings"));
    assert.equal(calls, 1);
  });

  it("withdraws every reachable listener when input disposal refuses", () => {
    const settingsEvents = new EventTarget();
    let settingsReads = 0;
    let publications = 0;
    const source = createCompanionPolicySource({
      program: "none",
      readSettings() {
        settingsReads += 1;
        return DEFAULT_SETTINGS;
      },
      settingsEvents,
      readPlayRegion: () => ({ status: "waiting", reason: "memory" }),
      subscribePlayRegion(listener) {
        listener({ status: "waiting", reason: "memory" });
        return () => { throw new Error("region unsubscribe refused"); };
      },
    });
    source.subscribe(() => { publications += 1; });

    assert.throws(
      () => source.dispose(),
      (error) => {
        assert(error instanceof AggregateError);
        assert.match(error.message, /policy source disposal failed/);
        assert.equal(error.errors.length, 1);
        assert.match(String(error.errors[0]), /region unsubscribe refused/);
        return true;
      },
    );
    settingsEvents.dispatchEvent(new Event("gw:tools-settings"));
    source.subscribe(() => { publications += 1; });
    assert.equal(settingsReads, 1);
    assert.equal(publications, 1);
  });
});
