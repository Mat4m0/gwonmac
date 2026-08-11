// Executes the copy the player is shown for each of the three certification
// states: whether the session is degraded at all, which features are named,
// what it promises about gameplay and recovery, and that an uncertified client
// is never reported as an out-of-date app.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compatibilityReport,
  renderClientCompatibility,
  showCompatibilityNotice,
} from "../../src/renderer/client-compatibility-notice.js";
import type {
  ClientCompatibility,
  ClientCompatibilityState,
  ClientSession,
} from "../../src/shared/contracts.js";
import type { EnhancementSelection } from "../../src/shared/enhancement-contracts.js";

const compatibility = (
  state: ClientCompatibilityState,
  selection: EnhancementSelection,
  enhancementActive =
    state === "certified" && Object.values(selection).some(Boolean),
): ClientCompatibility => ({
  state,
  clientSha256: "a".repeat(64),
  enhancementActive,
});

const NONE: EnhancementSelection = {
  nativeCursor: false,
  tools: false,
};
const CURSOR: EnhancementSelection = {
  nativeCursor: true,
  tools: false,
};
const SELECTIONS = [NONE, CURSOR];

const STATES: ClientCompatibilityState[] = [
  "certified",
  "template-only",
  "uncertified",
];

class FakeElement extends EventTarget {
  textContent = "";
  hidden = false;
  disabled = false;

  click() {
    this.dispatchEvent(new Event("click"));
  }
}

const COMPATIBILITY_ELEMENT_IDS = [
  "settings-compat-status",
  "settings-compat-detail",
  "settings-compat-version",
  "client-compat-title",
  "client-compat-detail",
  "client-compat-version",
  "client-compat",
  "client-compat-play",
] as const;

function compatibilityDom() {
  // Keyed by plain string, because the notice asks this stand-in for whatever
  // id it likes and a miss has to come back null the way a document does. The
  // accessor below is the one that holds callers to the declared set.
  const elements = new Map<string, FakeElement>(
    COMPATIBILITY_ELEMENT_IDS.map((id) => [id, new FakeElement()]),
  );
  const root = {
    getElementById: (id: string) => elements.get(id) ?? null,
  } as unknown as Document;
  return {
    root,
    element: (id: (typeof COMPATIBILITY_ELEMENT_IDS)[number]) => {
      const result = elements.get(id);
      assert.ok(result);
      return result;
    },
  };
}

const text = (state: ClientCompatibilityState, selection: EnhancementSelection) => {
  const report = compatibilityReport(compatibility(state, selection), selection);
  return [report.summary, ...report.details].join(" ");
};

describe("client compatibility notice", () => {
  it("degrades only where the session actually lost something", () => {
    assert.equal(compatibilityReport(compatibility("certified", CURSOR), CURSOR).degraded, false);
    assert.equal(compatibilityReport(compatibility("certified", NONE), NONE).degraded, false);
    assert.equal(
      compatibilityReport(compatibility("template-only", CURSOR), CURSOR).degraded,
      true,
    );
    assert.equal(
      compatibilityReport(compatibility("template-only", NONE), NONE).degraded,
      false,
    );
    // An uncertified build breaks saving even when no Enhancement tool was wanted.
    assert.equal(
      compatibilityReport(compatibility("uncertified", CURSOR), CURSOR).degraded,
      true,
    );
    assert.equal(
      compatibilityReport(compatibility("uncertified", NONE), NONE).degraded,
      true,
    );
  });

  it("reports a certified Enhancement preparation failure as retryable", () => {
    const report = compatibilityReport(
      compatibility("certified", CURSOR, false),
      CURSOR,
    );
    const said = [report.summary, ...report.details].join(" ");

    assert.equal(report.degraded, true);
    assert.equal(report.enhancementDegraded, true);
    assert.match(said, /could not be prepared/);
    assert.match(said, /game cursor/);
    assert.match(said, /Restart the app/);
    assert.match(said, /export diagnostics/);
    // A runtime failure is retryable; it must not borrow the certification
    // recovery sentence.
    assert.doesNotMatch(said, /cannot fix it/);
  });

  it("speaks player language, never project vocabulary", () => {
    for (const said of [
      text("uncertified", CURSOR),
      text("template-only", CURSOR),
      text("certified", NONE),
      [
        compatibilityReport(
          compatibility("certified", CURSOR, false),
          CURSOR,
        ).summary,
      ].join(" "),
    ]) {
      assert.doesNotMatch(said, /\bEnhancement\b/);
      assert.doesNotMatch(said, /certif/i);
    }
  });

  it("leads an ArenaNet update with the safety action and keeps play available", () => {
    for (const selection of SELECTIONS) {
      const report = compatibilityReport(
        compatibility("uncertified", selection),
        selection,
      );
      assert.match(report.summary, /disabled for your safety/);
      assert.match(report.details[0]!, /You can keep playing/);
      const said = [report.summary, ...report.details].join(" ");
      assert.match(said, /local Build and Team library remains available/);
      assert.match(said, /live game observations and Apply stay off/);
    }
  });

  it("names all three affected features on an uncertified build", () => {
    for (const selection of SELECTIONS) {
      const said = text("uncertified", selection);
      assert.match(said, /build templates/);
      assert.match(said, /screenshots/);
      assert.match(said, /chat logs/);
      // Not "some things may be broken".
      assert.doesNotMatch(said, /compatibility issue/i);
    }
  });

  it("says templates survive when only Enhancement is uncertified", () => {
    for (const selection of SELECTIONS) {
      const report = compatibilityReport(
        compatibility("template-only", selection),
        selection,
      );
      assert.match(report.details[0]!, /work normally/);
      assert.doesNotMatch([report.summary, ...report.details].join(" "), /untouched module/);
    }
  });

  it("names only the selected tools as unavailable", () => {
    for (const state of STATES) {
      for (const selection of SELECTIONS) {
        const report = compatibilityReport(
          compatibility(state, selection),
          selection,
        );
        const said = [report.summary, ...report.details].join(" ");
        const degraded =
          Object.values(selection).some(Boolean) && state !== "certified";
        assert.equal(report.enhancementDegraded, degraded);
        if (!degraded) continue;
        assert.equal(/game cursor/.test(said), selection.nativeCursor);
      }
    }
  });

  it("keeps gameplay and recovery honest wherever certification degrades", () => {
    for (const state of STATES) {
      for (const selection of SELECTIONS) {
        const report = compatibilityReport(
          compatibility(state, selection),
          selection,
        );
        // The retryable preparation failure has its own recovery sentence and
        // is covered above; this loop pins the certification-gap branches.
        if (!report.degraded || state === "certified") continue;
        const said = [report.summary, ...report.details].join(" ");
        assert.match(said, /Gameplay itself is unaffected/);
        // Recovery is an app update, offered as the action right beside the
        // sentence rather than left as "a separate question".
        assert.match(said, /Check for Updates/);
        // Not a retry, a reinstall or a cache clear, and the copy says so
        // rather than leaving the player to try all three.
        assert.match(said, /Retrying, reinstalling or clearing/);
      }
    }
  });

  it("never claims the app itself is out of date", () => {
    for (const state of STATES) {
      for (const selection of SELECTIONS) {
        const report = compatibilityReport(
          compatibility(state, selection),
          selection,
        );
        const said = [report.summary, ...report.details].join(" ");
        // "may already support this build" offers the check without asserting
        // an update exists — that fact is established by the check itself.
        assert.doesNotMatch(said, /update the app|app is out of date/i);
        if (report.degraded && state !== "certified") {
          assert.match(said, /may already support this build/);
        }
      }
    }
  });

  it("renders one report into both fixed surfaces and always shows the app version", () => {
    const dom = compatibilityDom();
    const beforeClient: ClientSession = {
      appVersion: "2026.7.0",
      compatibility: null,
      extendedMemory: null,
      healthToken: null,
    };
    assert.equal(
      renderClientCompatibility(dom.root, beforeClient, CURSOR),
      null,
    );
    assert.equal(
      dom.element("settings-compat-version").textContent,
      "App version 2026.7.0",
    );
    assert.equal(
      dom.element("client-compat-version").textContent,
      "Shown once per new game build · App version 2026.7.0.",
    );
    assert.equal(dom.element("settings-compat-status").hidden, true);
    assert.equal(dom.element("settings-compat-detail").hidden, true);

    const session: ClientSession = {
      appVersion: "2026.7.0",
      compatibility: compatibility("uncertified", CURSOR),
      extendedMemory: null,
      healthToken: null,
    };
    const report = renderClientCompatibility(dom.root, session, CURSOR);
    assert.ok(report);
    assert.equal(dom.element("settings-compat-status").hidden, false);
    assert.equal(
      dom.element("settings-compat-status").textContent,
      dom.element("client-compat-title").textContent,
    );
    assert.equal(
      dom.element("settings-compat-detail").textContent,
      dom.element("client-compat-detail").textContent,
    );
    assert.equal(
      dom.element("settings-compat-status").textContent,
      report.summary,
    );
  });

  it("dismisses the launcher notice even when acknowledgement cannot persist", async () => {
    const dom = compatibilityDom();
    dom.element("client-compat").hidden = true;
    let acknowledgements = 0;
    const dismissed = showCompatibilityNotice(dom.root, async () => {
      acknowledgements += 1;
      throw new Error("disk is full");
    });

    assert.equal(dom.element("client-compat").hidden, false);
    dom.element("client-compat-play").click();
    await dismissed;
    assert.equal(acknowledgements, 1);
    assert.equal(dom.element("client-compat-play").disabled, true);
    assert.equal(dom.element("client-compat").hidden, true);
  });
});
