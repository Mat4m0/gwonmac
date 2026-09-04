import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayRegionObservationInstallation } from "../../src/renderer/play-region-state-installation.ts";

const ready = (sequence: number, mapId = 81) => Object.freeze({
  status: "ready" as const,
  sequence,
  mapId,
  instanceType: 0,
  playRegion: "pve" as const,
  travelContext: "world" as const,
  characterKey: null,
  unlockedMapWords: null,
  guildHall: false,
  hasGuildHall: false,
});

test("play-region authority withdraws on staleness and requires a newer publication to recover", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  context.mock.timers.enable({ apis: ["setTimeout"] });

  const installation = createPlayRegionObservationInstallation(true);
  installation.setActive(true);
  installation.sink?.update(ready(2));
  assert.deepEqual(installation.state, ready(2));

  now = 499;
  context.mock.timers.tick(499);
  assert.deepEqual(installation.state, ready(2));

  now = 500;
  context.mock.timers.tick(1);
  assert.deepEqual(installation.state, { status: "waiting", reason: "stale" });

  installation.sink?.update(ready(2, 55));
  assert.deepEqual(
    installation.state,
    { status: "waiting", reason: "stale" },
    "the frozen sequence cannot restore authority with different payload bytes",
  );
  installation.sink?.update(ready(4, 55));
  assert.deepEqual(installation.state, ready(4, 55));

  installation.setActive(false);
  assert.deepEqual(installation.state, { status: "waiting", reason: "stale" });
  installation.sink?.update(ready(6, 449));
  assert.deepEqual(
    installation.state,
    { status: "waiting", reason: "stale" },
    "inactive observations cannot restore withdrawn authority",
  );

  installation.setActive(true);
  installation.sink?.update(ready(4, 449));
  assert.deepEqual(
    installation.state,
    { status: "waiting", reason: "stale" },
    "reactivation still requires a sequence newer than the last accepted record",
  );
  installation.sink?.update(ready(6, 449));
  assert.deepEqual(installation.state, ready(6, 449));

  installation.dispose();
});
