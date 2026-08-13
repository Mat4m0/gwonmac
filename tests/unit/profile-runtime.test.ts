import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  launchIssueForStage,
  ProfileRuntimeStore,
} from "../../src/main/core/profile-runtime.js";
import type { ProfileId } from "../../src/shared/multiple-accounts.js";

const id = (value: string) => value as ProfileId;

describe("Multiple Accounts runtime state", () => {
  it("tracks honest batch transitions without changing already-open accounts", () => {
    const runtime = new ProfileRuntimeStore();
    const open = id("open");
    const first = id("first");
    const second = id("second");
    runtime.set(open, "running");

    runtime.queue([open, first, second], (profileId) => profileId === open);
    assert.equal(runtime.get(open).state, "running");
    assert.equal(runtime.get(first).state, "queued");
    assert.equal(runtime.get(second).state, "queued");

    runtime.set(first, "opening");
    runtime.set(first, "checking");
    runtime.set(first, "running");
    assert.equal(runtime.get(first).state, "running");
  });

  it("releases the untouched queue after canary failure", () => {
    const runtime = new ProfileRuntimeStore();
    const canary = id("canary");
    const waiting = id("waiting");
    runtime.queue([canary, waiting], () => false);
    runtime.set(canary, "failed", launchIssueForStage("validating"));
    runtime.releaseQueued([waiting]);

    assert.deepEqual(runtime.get(canary), {
      state: "failed",
      launchIssue: "client-validation",
    });
    assert.deepEqual(runtime.get(waiting), { state: "ready" });
  });

  it("maps every failure stage to bounded player-safe vocabulary", () => {
    assert.deepEqual(
      ["preparing", "starting", "validating", "crashed", "unknown"].map(
        (stage) => launchIssueForStage(stage as Parameters<typeof launchIssueForStage>[0]),
      ),
      [
        "profile-preparation",
        "window-startup",
        "client-validation",
        "renderer-crash",
        "unknown",
      ],
    );
  });
});
