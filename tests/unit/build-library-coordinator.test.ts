/** Build-library concurrency belongs to its durable owner, not IPC. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BuildLibraryCoordinator } from "../../src/main/core/build-library-coordinator.js";
import { EMPTY_LIBRARY } from "../../src/shared/builds/parse-library.js";

test("rejects a stale write from another window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gwonmac-build-coordinator-"));
  const path = join(directory, "build-library.json");
  const coordinator = new BuildLibraryCoordinator();
  const firstWindow = {};
  const secondWindow = {};

  await coordinator.get(firstWindow, path);
  await coordinator.get(secondWindow, path);
  await coordinator.set(firstWindow, path, { ...EMPTY_LIBRARY, tags: ["current"] });

  await assert.rejects(
    coordinator.set(secondWindow, path, { ...EMPTY_LIBRARY, tags: ["stale"] }),
    /changed in another account/u,
  );
  assert.deepEqual((await coordinator.get(secondWindow, path)).library.tags, ["current"]);
});

test("requires a baseline read before the first write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gwonmac-build-coordinator-"));
  const coordinator = new BuildLibraryCoordinator();

  await assert.rejects(
    coordinator.set({}, join(directory, "build-library.json"), EMPTY_LIBRARY),
    /reload before saving/u,
  );
});
