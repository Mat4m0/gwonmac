import assert from "node:assert/strict";
import { test } from "node:test";
import { eliteMapSurfaces } from "../../src/renderer/elite-map-projection.js";
import { eliteWikiUrl } from "../../src/shared/elite-wiki.js";
import { ELITE_LOCATIONS } from "../../src/shared/elite-locations.js";
const context = { status: 1, sequence: 2, areaEpoch: 7, mapId: 482, layoutId: 1 } as const;
const native = { status: 1, generation: 7, frameId: 24, visible: true,
  viewportWidth: 1200, viewportHeight: 800, left: 100, bottom: 100, right: 740, top: 500 };
const compass = { ...native, cameraSequence: 9, compassDirectionX: 0, compassDirectionY: 1 };
const mission = { ...native, projectionStatus: 1, projectionSequence: 4, projectionGeneration: 7,
  zoom: 1, panX: 4666, panY: 4317, drawableWidth: 640, drawableHeight: 320,
  playerMapX: 4666, playerMapY: 4317, nativeMapWidth: 640, nativeMapHeight: 320 };
const world = { ...native, sequence: 11, continent: 0, zoom: 0,
  topLeftX: 0, topLeftY: 0, bottomRightX: 8192, bottomRightY: 16384 };
const anchor = { status: 1, generation: 7, continent: 0, worldAnchorX: 4600, worldAnchorY: 4300, mapMinX: 0, mapMinY: 0, mapMaxX: 100, mapMaxY: 100 };
const input = { anchor, onWorldMap: true, context, mapId: 482, compass, mission, world,
  canvas: { left: 0, top: 0, width: 1200, height: 800 } };
test("elite surfaces follow native pan/zoom and refuse stale instances independently", () => {
  const ready = eliteMapSurfaces(input);
  assert.ok(ready.world); assert.ok(ready.mission?.transform);
  const panned = eliteMapSurfaces({ ...input, mission: { ...mission, panX: 4000, zoom: 2 } });
  assert.notEqual(ready.mission.transform.e, panned.mission?.transform?.e);
  assert.deepEqual(eliteMapSurfaces({ ...input, mapId: 55 }), { world: null, mission: null });
  for (const overrides of [{ onWorldMap: false }, { anchor: null }, { anchor: { ...anchor, generation: 6 } }, { anchor: { ...anchor, continent: 5 } }]) {
    const unsupported = eliteMapSurfaces({ ...input, ...overrides });
    assert.ok(unsupported.mission?.box); assert.equal(unsupported.mission.transform, null); assert.ok(unsupported.world);
  }
  const staleMission = eliteMapSurfaces({ ...input, mission: { ...mission, projectionGeneration: 6 } });
  assert.ok(staleMission.world); assert.equal(staleMission.mission?.transform, null);
  const closedWorld = eliteMapSurfaces({ ...input, world: { ...world, visible: false } });
  assert.equal(closedWorld.world, null); assert.ok(closedWorld.mission);
  assert.deepEqual(eliteMapSurfaces({ ...input, context: { ...context, areaEpoch: 8 } }), { world: null, mission: null });
});
test("wiki actions resolve reviewed data and never accept caller URLs", () => {
  const boss = ELITE_LOCATIONS.find((entry) => entry.boss === "Lissah the Packleader")!;
  assert.equal(eliteWikiUrl({ locationId: boss.id, page: "skill" }), "https://wiki.guildwars.com/wiki/Game_link:Skill_338");
  assert.match(eliteWikiUrl({ locationId: boss.id, page: "boss" }), /Lissah_the_Packleader$/u);
  assert.throws(() => eliteWikiUrl({ locationId: boss.id, page: "boss", url: "https://evil.example" }));
  assert.throws(() => eliteWikiUrl({ locationId: "https://evil.example", page: "boss" }));
});
