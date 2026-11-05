import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEEDBACK_URL, sendLauncherFeedback } from "../../src/main/core/launcher-feedback.ts";
import { parseLauncherFeedback } from "../../src/shared/launcher-contracts.ts";

const context = { appVersion: "2026.10.0", updateTrack: "beta", macosVersion: "27.0" } as const;

describe("launcher feedback", () => {
  it("refuses a report main must not forward", () => {
    const refused: readonly unknown[] = [
      null,
      { kind: "problem" },
      { kind: "problem", message: "   " },
      { kind: "problem", message: "x".repeat(4001) },
      { kind: "spam", message: "Hello" },
      { kind: "problem", message: "Hello", email: "not-an-email" },
      { kind: "problem", message: "Hello", accountName: "Main account" },
    ];
    for (const value of refused) assert.throws(() => parseLauncherFeedback(value), Error, JSON.stringify(value));
    assert.deepEqual(
      parseLauncherFeedback({ kind: "idea", message: "  Add a damage monitor  ", email: " me@example.com " }),
      { kind: "idea", message: "Add a damage monitor", email: "me@example.com" },
    );
  });

  it("posts only the report and version facts to the fixed Basin form", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await sendLauncherFeedback(async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }, { kind: "problem", message: "The launcher opened behind my game." }, context);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, FEEDBACK_URL);
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[0]!.init.credentials, "omit");
    assert.equal(calls[0]!.init.redirect, "error");
    assert.deepEqual(Object.fromEntries(calls[0]!.init.body as URLSearchParams), {
      kind: "problem",
      message: "The launcher opened behind my game.",
      appVersion: "2026.10.0",
      updateTrack: "beta",
      macosVersion: "27.0",
    });
  });

  it("reports a refused submission as a failure", async () => {
    await assert.rejects(sendLauncherFeedback(async () => new Response("", { status: 422 }), { kind: "other", message: "Hi" }, context));
  });
});
