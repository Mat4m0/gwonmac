import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeStableSettings,
  projectStableOwnedSettings,
  validateCandidateSettings,
} from "../../scripts/release-settings-compatibility.ts";

describe("release settings compatibility", () => {
  it("normalizes only valid Stable rollback shapes", () => {
    assert.deepEqual(
      canonicalizeStableSettings({ teamManagement: false }, { disk: false }),
      { buildLibrary: false },
    );
    assert.deepEqual(
      canonicalizeStableSettings({ buildLibrary: true }, { disk: false }),
      { buildLibrary: true },
    );
    assert.deepEqual(
      canonicalizeStableSettings(
        { formatVersion: 1, buildLibrary: false, teamManagement: false },
        { disk: true },
      ),
      { buildLibrary: false },
    );
    assert.throws(
      () => canonicalizeStableSettings(
        { buildLibrary: true, teamManagement: false },
        { disk: false },
      ),
      /differs from buildLibrary/u,
    );
    assert.throws(
      () => canonicalizeStableSettings({ teamManagement: "false" }, { disk: false }),
      /not a boolean/u,
    );
  });

  it("refuses a candidate that drops its canonical schema", () => {
    assert.deepEqual(
      validateCandidateSettings({ buildLibrary: false }, { disk: false }),
      { buildLibrary: false },
    );
    assert.throws(
      () => validateCandidateSettings({ teamManagement: false }, { disk: false }),
      /omit canonical buildLibrary/u,
    );
    assert.throws(
      () => validateCandidateSettings(
        { buildLibrary: false, teamManagement: false },
        { disk: true },
      ),
      /formatVersion changed/u,
    );
  });

  it("projects additive candidate settings through the rollback Stable's ownership", () => {
    const stable = { renderScale: 2, buildLibrary: false };
    assert.deepEqual(
      projectStableOwnedSettings(
        { ...stable, cartographyOverlayEnabled: true },
        stable,
      ),
      stable,
    );
    assert.deepEqual(
      projectStableOwnedSettings(
        { ...stable, renderScale: 1.5, cartographyOverlayEnabled: true },
        stable,
      ),
      { renderScale: 1.5, buildLibrary: false },
    );
    assert.throws(
      () => projectStableOwnedSettings({ renderScale: 2 }, stable),
      /omit Stable-owned key buildLibrary/u,
    );
  });
});
