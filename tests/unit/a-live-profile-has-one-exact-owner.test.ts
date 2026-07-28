import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  acquireLiveSession,
  liveSessionPath,
} from "../../scripts/enhancements-live/live-session.js";

describe("the persistent live profile has one exact owner", () => {
  it("records its child and refuses a second writer", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gwonmac-profile-"));
    const session = await acquireLiveSession(profile, "team-readback");
    await session.update({
      childPid: process.pid,
      endpoint: "ws://127.0.0.1/devtools/browser/test",
      state: "running",
    });

    const record = JSON.parse(await readFile(liveSessionPath(profile), "utf8"));
    assert.equal(record.runnerPid, process.pid);
    assert.equal(record.childPid, process.pid);
    assert.equal(record.scenario, "team-readback");
    await assert.rejects(
      acquireLiveSession(profile, "boot"),
      /profile already has live scenario team-readback \(running\)/,
    );

    await session.release();
    const next = await acquireLiveSession(profile, "boot");
    await next.release();
  });

  it("reclaims a well-formed lock only when both exact PIDs are dead", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "gwonmac-profile-"));
    await writeFile(
      liveSessionPath(profile),
      JSON.stringify({
        version: 1,
        runnerPid: 2_000_000_000,
        childPid: null,
        scenario: "old",
        state: "failed",
        endpoint: null,
        startedAt: new Date(0).toISOString(),
      }),
      { mode: 0o600 },
    );
    const session = await acquireLiveSession(profile, "boot");
    await session.release();
  });
});
