// Executes the copy the player is shown for each of the three certification
// states: whether the session is degraded at all, which features are named,
// what it promises about gameplay and recovery, and that an uncertified client
// is never reported as an out-of-date app.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compatibilityReport } from "../../src/renderer/client-compatibility-notice.js";
import type {
  ClientCompatibility,
  ClientCompatibilityState,
} from "../../src/shared/contracts.js";

const compatibility = (
  state: ClientCompatibilityState,
  toolboxRequested: boolean,
): ClientCompatibility => ({
  state,
  clientSha256: "a".repeat(64),
  toolboxRequested,
});

const STATES: ClientCompatibilityState[] = [
  "certified",
  "template-only",
  "uncertified",
];

const text = (state: ClientCompatibilityState, toolboxRequested: boolean) => {
  const report = compatibilityReport(compatibility(state, toolboxRequested));
  return [report.summary, ...report.details].join(" ");
};

describe("client compatibility notice", () => {
  it("degrades only where the session actually lost something", () => {
    // State 2 with the cursor switched off costs the player nothing: the
    // pointer they get is the one they asked for.
    assert.equal(compatibilityReport(compatibility("certified", true)).degraded, false);
    assert.equal(compatibilityReport(compatibility("certified", false)).degraded, false);
    assert.equal(
      compatibilityReport(compatibility("template-only", true)).degraded,
      true,
    );
    assert.equal(
      compatibilityReport(compatibility("template-only", false)).degraded,
      false,
    );
    // An uncertified build breaks saving whether or not a cursor was wanted.
    assert.equal(compatibilityReport(compatibility("uncertified", true)).degraded, true);
    assert.equal(
      compatibilityReport(compatibility("uncertified", false)).degraded,
      true,
    );
  });

  it("names all three affected features on an uncertified build", () => {
    for (const requested of [true, false]) {
      const said = text("uncertified", requested);
      assert.match(said, /build templates/);
      assert.match(said, /screenshots/);
      assert.match(said, /chat logs/);
      // Not "some things may be broken".
      assert.doesNotMatch(said, /compatibility issue/i);
    }
  });

  it("says templates survive when only the cursor is uncertified", () => {
    for (const requested of [true, false]) {
      const report = compatibilityReport(compatibility("template-only", requested));
      assert.match(report.details[0]!, /work normally/);
      assert.doesNotMatch([report.summary, ...report.details].join(" "), /untouched module/);
    }
  });

  it("promises the pointer only where the pointer is actually lost", () => {
    for (const state of STATES) {
      for (const requested of [true, false]) {
        const report = compatibilityReport(compatibility(state, requested));
        const said = [report.summary, ...report.details].join(" ");
        assert.equal(report.cursorDegraded, requested && state !== "certified");
        assert.equal(
          /macOS draws the pointer/.test(said),
          report.cursorDegraded,
          `${state}/${requested} must mention macOS drawing the pointer only when it does`,
        );
      }
    }
  });

  it("keeps gameplay and recovery honest wherever it degrades", () => {
    for (const state of STATES) {
      for (const requested of [true, false]) {
        const report = compatibilityReport(compatibility(state, requested));
        if (!report.degraded) continue;
        const said = [report.summary, ...report.details].join(" ");
        assert.match(said, /Gameplay itself is unaffected/);
        assert.match(said, /takes a new release of this app/);
        // Recovery is not a retry, a reinstall or a cache clear, and the copy
        // says so rather than leaving the player to try all three.
        assert.match(said, /Retrying, reinstalling or clearing/);
      }
    }
  });

  it("never reports an uncertified client as an out-of-date app", () => {
    for (const state of STATES) {
      for (const requested of [true, false]) {
        const report = compatibilityReport(compatibility(state, requested));
        const said = [report.summary, ...report.details].join(" ");
        assert.doesNotMatch(said, /update the app|app is out of date\./i);
        if (report.degraded) {
          assert.match(said, /does not mean the app is out of date/);
          assert.match(said, /separate question/);
        }
      }
    }
  });
});
