import assert from "node:assert/strict";
import test from "node:test";
import { resolvePackageMode } from "../../scripts/package-mode.ts";

test("packaging accepts only the four complete supported intents", () => {
  assert.deepEqual(resolvePackageMode(undefined), {
    intent: "local",
    kind: "adhoc",
    productChannel: "release",
  });
  assert.deepEqual(resolvePackageMode(""), resolvePackageMode("local"));
  assert.deepEqual(resolvePackageMode("developer-build"), {
    intent: "developer-build",
    kind: "adhoc",
    productChannel: "preview",
  });
  assert.deepEqual(resolvePackageMode("release"), {
    intent: "release",
    kind: "signed",
    productChannel: "release",
    channel: "release",
  });
  assert.deepEqual(resolvePackageMode("development"), {
    intent: "development",
    kind: "signed",
    productChannel: "development",
    channel: "development",
  });
  for (const invalid of [null, "preview", "signed", "development-handoff"]) {
    assert.throws(() => resolvePackageMode(invalid), /unknown GW_PACKAGE_INTENT/u);
  }
});
