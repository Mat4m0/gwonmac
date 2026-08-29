import assert from "node:assert/strict";
import test from "node:test";
import {
  TOOLBOX_CARTOGRAPHY_CONTINENTS,
  TOOLBOX_CARTOGRAPHY_SOURCE,
} from "../../src/renderer/cartography-spike/toolbox-cartography-data.js";

test("bundles the exact minimal GWToolbox++ reachable cartography masks", () => {
  assert.deepEqual(TOOLBOX_CARTOGRAPHY_SOURCE, {
    repository: "https://github.com/gwdevhub/GWToolboxpp",
    commit: "cbe940d3edcc0c47fc02a59079a8f6e08d11f4cf",
    path: "GWToolboxdll/Widgets/CartographyData.h",
    sha256: "a20298a47f32eac2b72256659240a7abd7ebe93c573af1bd7ce069ebf8c18453",
  });
  assert.deepEqual(TOOLBOX_CARTOGRAPHY_CONTINENTS.map(({ id }) => id), [0, 1, 2, 3, 4, 5]);
  for (const continent of TOOLBOX_CARTOGRAPHY_CONTINENTS) {
    assert.deepEqual(Object.keys(continent).sort(), ["creditable", "id", "standable"]);
    for (const mask of [continent.standable, continent.creditable]) {
      assert.ok(mask.width > 0 && mask.height > 0);
      assert.equal(mask.bits.length, Math.ceil(mask.width * mask.height / 8));
      assert.ok(mask.bits.some((byte) => byte !== 0));
    }
  }
});
