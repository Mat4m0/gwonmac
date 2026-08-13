import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compatibilityReport,
  renderClientCompatibility,
  showCompatibilityNotice,
} from "../../src/renderer/client-compatibility-notice.js";
import type { ClientCompatibility, ClientSession } from "../../src/shared/contracts.js";

const available = { status: "available" } as const;
const off = { status: "off" } as const;
const unavailable = (reason: "game-update" | "preparation-failed") =>
  ({ status: "unavailable", reason }) as const;

function compatibility(
  overrides: Partial<ClientCompatibility["features"]> = {},
): ClientCompatibility {
  return {
    clientSha256: "a".repeat(64),
    features: {
      gameFileSaving: available,
      nativeCursor: off,
      targetObservation: off,
      partyObservation: off,
      teamApply: off,
      ...overrides,
    },
  };
}

class FakeElement extends EventTarget {
  textContent = "";
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  click() { this.dispatchEvent(new Event("click")); }
}

const IDS = [
  "settings-compat-status", "settings-compat-detail", "settings-compat-version",
  "client-compat-title", "client-compat-detail", "client-compat-version",
  "client-compat", "client-compat-play",
  "client-compat-check", "client-compat-update",
  "settings-feature-gameFileSaving", "settings-feature-nativeCursor",
  "settings-feature-targetObservation", "settings-feature-partyObservation",
  "settings-feature-teamApply",
] as const;

function compatibilityDom() {
  const elements = new Map<string, FakeElement>(IDS.map((id) => [id, new FakeElement()]));
  return {
    root: { getElementById: (id: string) => elements.get(id) ?? null } as unknown as Document,
    element(id: (typeof IDS)[number]) {
      const element = elements.get(id);
      assert.ok(element);
      return element;
    },
  };
}

describe("client compatibility notice", () => {
  it("does not interrupt when every selected feature is available", () => {
    assert.deepEqual(compatibilityReport(compatibility()), {
      degraded: false,
      acknowledgePerBuild: false,
      recovery: null,
      summary: "This Guild Wars version is supported.",
      details: ["Everything you turned on is available."],
    });
  });

  it("uses the exact single-feature copy", () => {
    const cases = [
      ["gameFileSaving", "Some Guild Wars files won’t save in this session."],
      ["nativeCursor", "The Guild Wars cursor is temporarily unavailable."],
      ["teamApply", "Apply team is temporarily unavailable."],
    ] as const;
    for (const [feature, title] of cases) {
      const report = compatibilityReport(compatibility({
        [feature]: unavailable("game-update"),
      }));
      assert.equal(report.summary, title);
      assert.equal(report.recovery, "update");
      assert.equal(report.acknowledgePerBuild, true);
    }
  });

  it("groups target and party observation without implementation language", () => {
    const report = compatibilityReport(compatibility({
      targetObservation: unavailable("game-update"),
      partyObservation: unavailable("game-update"),
    }));
    assert.equal(report.summary, "Live game information is temporarily unavailable.");
    assert.match(report.details.join(" "), /saved builds and teams still work/);
  });

  it("lists several unavailable features and preserves safe local work", () => {
    const report = compatibilityReport(compatibility({
      nativeCursor: unavailable("game-update"),
      teamApply: unavailable("game-update"),
    }));
    assert.equal(report.summary, "Some GWonMac features are temporarily unavailable.");
    assert.equal(
      report.details[0],
      "Unavailable: Guild Wars cursor, Apply team.",
    );
    assert.match(report.details[1]!, /Build templates.*saved builds and teams still work/);
  });

  it("makes preparation failures retry each launch", () => {
    const report = compatibilityReport(compatibility({
      nativeCursor: unavailable("preparation-failed"),
    }));
    assert.equal(report.summary, "The Guild Wars cursor didn’t start.");
    assert.equal(report.recovery, "restart");
    assert.equal(report.acknowledgePerBuild, false);
    assert.match(report.details.join(" "), /Restart GWonMac to try again/);
  });

  it("keeps forbidden player-facing terms out of every report", () => {
    for (const reason of ["game-update", "preparation-failed"] as const) {
      const said = compatibilityReport(compatibility({
        gameFileSaving: unavailable(reason),
        nativeCursor: unavailable(reason),
        targetObservation: unavailable(reason),
        partyObservation: unavailable(reason),
        teamApply: unavailable(reason),
      }));
      assert.doesNotMatch(
        [said.summary, ...said.details].join(" "),
        /\b(Core|Enhancement|certificate|module)\b|command generation|stat|timing|reinstall|cache clearing/i,
      );
    }
  });

  it("renders one report into launcher and Settings", () => {
    const dom = compatibilityDom();
    const before: ClientSession = {
      appVersion: "2026.7.0", compatibility: null, extendedMemory: null, healthToken: null,
    };
    assert.equal(renderClientCompatibility(dom.root, before), null);
    assert.equal(dom.element("settings-compat-status").hidden, true);

    const session: ClientSession = {
      ...before,
      compatibility: compatibility({ nativeCursor: unavailable("game-update") }),
    };
    const report = renderClientCompatibility(dom.root, session);
    assert.ok(report);
    assert.equal(dom.element("settings-compat-status").textContent, report.summary);
    assert.equal(dom.element("client-compat-title").textContent, report.summary);
  });

  it("dismisses the launcher even when acknowledgement cannot persist", async () => {
    const dom = compatibilityDom();
    let acknowledgements = 0;
    const dismissed = showCompatibilityNotice(dom.root, async () => {
      acknowledgements += 1;
      throw new Error("disk is full");
    });
    dom.element("client-compat-play").click();
    await dismissed;
    assert.equal(acknowledgements, 1);
    assert.equal(dom.element("client-compat").hidden, true);
  });
});
