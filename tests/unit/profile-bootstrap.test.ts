import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bootstrapProfiles } from "../../src/main/profile-bootstrap.js";

test("profile bootstrap creates Default and atomically adopts legacy documents", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "gw-bootstrap-"));
  await writeFile(path.join(userData, "credentials.bin"), "ciphertext");
  await writeFile(path.join(userData, "window-state.json"), "window");
  await writeFile(path.join(userData, "clear-game-storage-on-start"), "");

  const result = await bootstrapProfiles({
    userData,
    profilesRoot: path.join(userData, "profiles"),
    trashItem: async () => {},
  });
  assert.equal(result.profile.label, "Default");
  assert.equal(await readFile(result.profile.paths.credentials, "utf8"), "ciphertext");
  assert.equal(await readFile(result.profile.paths.windowState, "utf8"), "window");
  assert.equal((await stat(result.profile.paths.gameStorageClearRequest)).size, 0);
  await assert.rejects(stat(path.join(userData, "credentials.bin")), {
    code: "ENOENT",
  });
});

test("profile bootstrap is idempotent and never overwrites canonical documents", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "gw-bootstrap-retry-"));
  const first = await bootstrapProfiles({
    userData,
    profilesRoot: path.join(userData, "profiles"),
    trashItem: async () => {},
  });
  await writeFile(first.profile.paths.credentials, "canonical");
  await writeFile(path.join(userData, "credentials.bin"), "legacy-retry");

  const second = await bootstrapProfiles({
    userData,
    profilesRoot: path.join(userData, "profiles"),
    trashItem: async () => {},
  });
  assert.equal(second.profile.id, first.profile.id);
  assert.equal(await readFile(second.profile.paths.credentials, "utf8"), "canonical");
  assert.equal(
    await readFile(path.join(userData, "credentials.bin"), "utf8"),
    "legacy-retry",
  );
});
