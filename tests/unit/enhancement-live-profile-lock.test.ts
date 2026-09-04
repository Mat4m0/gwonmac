/** Live runs refuse an occupied Electron profile before starting a second app. */
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { activeProfileOwner } from "../../scripts/enhancements-live/profile-lock.js";

test("detects an active profile owner and ignores a stale lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gwonmac-live-lock-"));
  try {
    assert.equal(await activeProfileOwner(root, () => assert.fail("no lock to probe")), null);
    await symlink("host.example-4812", path.join(root, "SingletonLock"));
    assert.equal(await activeProfileOwner(root, (pid) => assert.equal(pid, 4_812)), 4_812);
    assert.equal(await activeProfileOwner(root, () => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    }), null);
    assert.equal(await activeProfileOwner(root, () => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    }), 4_812);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
