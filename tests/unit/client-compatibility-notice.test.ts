import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compatibilityReport,
  renderClientCompatibility,
  showCompatibilityNotice,
} from "../../src/renderer/client-compatibility-notice.js";
import type { ClientCompatibility, ClientSession } from "../../src/shared/contracts.js";

const STANDARD_MEMORY = Object.freeze({
  requestedAtLaunch: false,
  status: "standard",
  effectiveCapBytes: 2_147_483_648,
  fallbackReason: null,
} as const);

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
      travelAction: off,
      xunlaiAction: off,
      chatAliases: off,
      skillSlotGeometry: off,
      skillCooldownObservation: off,
      ...overrides,
    },
  };
}

class FakeElement extends EventTarget {
  textContent = "";
  hidden = false;
  disabled = false;
  open = false;
  dataset: Record<string, string> = {};
  click() { this.dispatchEvent(new Event("click")); }
}

const IDS = [
  "settings-compat-status", "settings-compat-detail", "settings-compat-version",
  "settings-availability",
  "client-compat-title", "client-compat-detail", "client-compat-version",
  "client-compat", "client-compat-play",
  "client-compat-check", "client-compat-restart", "client-compat-update",
  "settings-feature-gameFileSaving", "settings-feature-nativeCursor",
  "settings-feature-targetObservation", "settings-feature-partyObservation",
  "settings-feature-teamApply",
  "settings-feature-travelAction", "settings-feature-xunlaiAction",
  "settings-feature-chatAliases", "settings-feature-skillSlotGeometry",
  "settings-feature-skillCooldownObservation",
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

  it("names only the unavailable observation", () => {
    for (const [feature, unavailableName, availableName] of [
      ["targetObservation", "Target distance", "party details"],
      ["partyObservation", "Live party details", "Target distance"],
    ] as const) {
      const report = compatibilityReport(compatibility({
        [feature]: unavailable("game-update"),
      }));
      assert.match(report.details[0]!, new RegExp(unavailableName, "i"));
      assert.doesNotMatch(report.details[0]!, new RegExp(availableName, "i"));
    }
  });

  it("keeps update and restart recovery distinct when reasons are mixed", () => {
    const report = compatibilityReport(compatibility({
      nativeCursor: unavailable("game-update"),
      teamApply: unavailable("preparation-failed"),
    }));
    assert.equal(report.recovery, "both");
    assert.equal(report.acknowledgePerBuild, false);
    assert.match(report.details.join(" "), /Restart GWonMac/);
    assert.match(report.details.join(" "), /check for updates/);
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

  it("keeps every feature and reason combination internally consistent", () => {
    const optional = [
      available,
      off,
      unavailable("game-update"),
      unavailable("preparation-failed"),
    ] as const;
    const required = [
      available,
      unavailable("game-update"),
      unavailable("preparation-failed"),
    ] as const;
    for (const gameFileSaving of required) {
      for (const nativeCursor of optional) {
        for (const targetObservation of optional) {
          for (const partyObservation of optional) {
            for (const teamApply of optional) {
              for (const travelAction of optional) {
                for (const xunlaiAction of optional) {
                  for (const chatAliases of optional) {
                    const features = {
                      gameFileSaving,
                      nativeCursor,
                      targetObservation,
                      partyObservation,
                      teamApply,
                      travelAction,
                      xunlaiAction,
                      chatAliases,
                      skillSlotGeometry: off,
                      skillCooldownObservation: off,
                    } satisfies ClientCompatibility["features"];
                const report = compatibilityReport({
                  clientSha256: "b".repeat(64),
                  features,
                });
                const missing = Object.values(features).filter(
                  (feature) => feature.status === "unavailable",
                );
                assert.equal(report.degraded, missing.length > 0);
                const reasons = new Set(missing.map((feature) =>
                  feature.status === "unavailable" ? feature.reason : null));
                assert.equal(
                  report.recovery,
                reasons.size === 0
                  ? null
                  : reasons.size === 2
                    ? "both"
                    : reasons.has("preparation-failed") ? "restart" : "update",
              );
              assert.equal(
                report.acknowledgePerBuild,
                reasons.size === 1 && reasons.has("game-update"),
              );
              assert.doesNotMatch(
                [report.summary, ...report.details].join(" "),
                /\b(Core|Enhancement|certificate|module)\b|command generation|stat|timing|reinstall|cache clearing/i,
              );
                  }
                }
              }
            }
          }
        }
      }
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
      extendedMemory: STANDARD_MEMORY,
      compatibility: compatibility({ nativeCursor: unavailable("game-update") }),
    };
    const report = renderClientCompatibility(dom.root, session);
    assert.ok(report);
    assert.equal(dom.element("settings-compat-status").textContent, report.summary);
    assert.equal(dom.element("client-compat-title").textContent, report.summary);
    assert.equal(dom.element("settings-feature-nativeCursor").textContent, "Unavailable");
    assert.equal(dom.element("settings-availability").open, true);
  });

  it("reports cooldown presentation unavailable when slot geometry is unavailable", () => {
    const dom = compatibilityDom();
    renderClientCompatibility(dom.root, {
      appVersion: "2026.7.0",
      extendedMemory: STANDARD_MEMORY,
      healthToken: null,
      compatibility: compatibility({
        skillSlotGeometry: unavailable("game-update"),
        skillCooldownObservation: available,
      }),
    });
    assert.equal(
      dom.element("settings-feature-skillCooldownObservation").textContent,
      "Unavailable",
    );
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
