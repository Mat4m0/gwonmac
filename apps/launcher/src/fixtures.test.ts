import { describe, expect, it } from "vitest";
import { fixtureSnapshotFor } from "./fixtures";

describe("launcher fixture scenarios", () => {
  it("provides every release state without Electron or player data", () => {
    expect(fixtureSnapshotFor("?fixture=fresh").experience.setup).toBe("pending");
    expect(fixtureSnapshotFor("?fixture=preparing").readiness.state).toBe("preparing");
    expect(fixtureSnapshotFor("?fixture=repair").readiness.state).toBe("repair-required");
    expect(fixtureSnapshotFor("?fixture=offline").readiness.state).toBe("offline-playable");
    expect(fixtureSnapshotFor("?fixture=update").appUpdate.phase).toBe("ready");
    expect(fixtureSnapshotFor("?fixture=failed").profiles[0]!.state).toBe("failed");
    expect(fixtureSnapshotFor("?fixture=production").contentAvailability.feedback).toBe("placeholder");
  });
});
