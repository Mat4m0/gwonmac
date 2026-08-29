import assert from "node:assert/strict";

function settingsRecord(raw: unknown): Record<string, unknown> {
  assert.ok(
    typeof raw === "object" && raw !== null && !Array.isArray(raw),
    "cross-version settings are not an object",
  );
  return raw as Record<string, unknown>;
}

function withoutFormat(
  raw: unknown,
  requireFormat: boolean,
): Record<string, unknown> {
  const { formatVersion, ...settings } = settingsRecord(raw);
  if (requireFormat || formatVersion !== undefined) {
    assert.equal(formatVersion, 1, "settings.json formatVersion changed");
  }
  return settings;
}

/** Normalize only the one released Stable alias allowed by the rollback gate. */
export function canonicalizeStableSettings(
  raw: unknown,
  options: Readonly<{ disk: boolean }>,
): Record<string, unknown> {
  const { teamManagement, ...settings } = withoutFormat(raw, options.disk);
  if (teamManagement !== undefined) {
    assert.equal(typeof teamManagement, "boolean", "teamManagement is not a boolean");
    if ("buildLibrary" in settings) {
      assert.equal(
        teamManagement,
        settings.buildLibrary,
        "rollback teamManagement projection differs from buildLibrary",
      );
    } else {
      settings.buildLibrary = teamManagement;
    }
  }
  return settings;
}

/** Require the candidate's canonical key; its legacy alias is projection only. */
export function validateCandidateSettings(
  raw: unknown,
  options: Readonly<{ disk: boolean }>,
): Record<string, unknown> {
  const { teamManagement, ...settings } = withoutFormat(raw, options.disk);
  assert.equal(
    typeof settings.buildLibrary,
    "boolean",
    "candidate settings omit canonical buildLibrary",
  );
  if (teamManagement !== undefined) {
    assert.equal(typeof teamManagement, "boolean", "teamManagement is not a boolean");
    assert.equal(
      teamManagement,
      settings.buildLibrary,
      "rollback teamManagement projection differs from buildLibrary",
    );
  }
  return settings;
}

/** Compare a candidate through the durable settings surface the rollback Stable owns. */
export function projectStableOwnedSettings(
  candidate: unknown,
  stable: unknown,
): Record<string, unknown> {
  const candidateSettings = settingsRecord(candidate);
  const stableSettings = settingsRecord(stable);
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(stableSettings)) {
    assert.ok(
      Object.hasOwn(candidateSettings, key),
      `candidate settings omit Stable-owned key ${key}`,
    );
    projected[key] = candidateSettings[key];
  }
  return projected;
}
