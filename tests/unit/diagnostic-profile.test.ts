import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadDiagnosticProfile,
  saveDiagnosticProfile,
} from "../../src/main/core/diagnostic-profile.ts";
import { diagnosticProfilePolicy } from "../../src/shared/diagnostic-profile.ts";

describe("diagnostic profile storage", () => {
  it("defaults to standard and persists every closed profile", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gw-diagnostic-profile-"));
    const file = path.join(root, "profile.json");
    try {
      assert.equal(await loadDiagnosticProfile(file), "standard");
      for (const profile of [
        "no-gl-overrides",
        "official-baseline",
        "direct-canvas",
        "standard",
      ] as const) {
        assert.equal(await saveDiagnosticProfile(file, profile), profile);
        assert.equal(await loadDiagnosticProfile(file), profile);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses malformed persisted state instead of guessing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gw-diagnostic-profile-"));
    const file = path.join(root, "profile.json");
    try {
      for (const value of [
        { profile: "official-baseline" },
        { formatVersion: 2, profile: "official-baseline" },
        { formatVersion: 1, profile: "mystery" },
      ]) {
        await writeFile(file, JSON.stringify(value));
        assert.equal(await loadDiagnosticProfile(file), "standard");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("diagnostic profile policy", () => {
  it("keeps each isolation profile explicit and internally consistent", () => {
    assert.deepEqual(diagnosticProfilePolicy("standard"), {
      officialClient: false,
      glOverrides: true,
      presentationPath: "offscreen",
    });
    assert.deepEqual(diagnosticProfilePolicy("no-gl-overrides"), {
      officialClient: false,
      glOverrides: false,
      presentationPath: "offscreen",
    });
    assert.deepEqual(diagnosticProfilePolicy("official-baseline"), {
      officialClient: true,
      glOverrides: false,
      presentationPath: "offscreen",
    });
    assert.deepEqual(diagnosticProfilePolicy("direct-canvas"), {
      officialClient: true,
      glOverrides: false,
      presentationPath: "direct",
    });
  });
});
