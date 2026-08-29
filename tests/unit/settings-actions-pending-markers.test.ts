// A missing reset marker is the normal no-op startup path. Any other stat
// failure means startup cannot know whether a durable destructive request is
// pending, so it must stay visible instead of being misclassified as absent.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { GamePaths } from "../../src/main/paths.js";

register(
  `data:text/javascript,${encodeURIComponent(
    `const module = (source) => ({
       url: "data:text/javascript," + encodeURIComponent(source),
       format: "module",
       shortCircuit: true,
     });
     export function resolve(specifier, context, next) {
       if (specifier === "electron") {
         return module(
           "export const app = {}; export const dialog = {};" +
           "export const session = { defaultSession: { clearStorageData: async () => {} } };",
         );
       }
       if (specifier.endsWith("/diagnostics.js")) {
         return module("export const logEvent = () => {};");
       }
       if (specifier.endsWith("/renderer-commands.js")) {
         return module("export const resetGameInput = async () => {};");
       }
       return next(specifier, context);
     }`,
  )}`,
);

const { applyPendingCacheClear, applyPendingGameStorageReset } =
  await import("../../src/main/settings-actions.ts");

const root = await mkdtemp(path.join(tmpdir(), "gw-pending-markers-"));
after(() => rm(root, { recursive: true, force: true }));

function pathsWithMarkers(
  cacheClearRequest: string,
  gameStorageClearRequest: string,
): GamePaths {
  return {
    cacheClearRequest,
    gameStorageClearRequest,
    chunks: path.join(root, "chunks"),
    artifacts: path.join(root, "game", "artifacts"),
    previousArtifacts: path.join(root, "game", "artifacts-previous"),
    rejectedClient: path.join(root, "game", "rejected-client.json"),
  } as GamePaths;
}

test("ENOENT means no destructive startup action is pending", async () => {
  const paths = pathsWithMarkers(
    path.join(root, "missing-cache-marker"),
    path.join(root, "missing-storage-marker"),
  );

  await applyPendingCacheClear(paths);
  await applyPendingGameStorageReset(paths, 1);
});

test("marker inspection failures other than ENOENT remain visible", async () => {
  const notDirectory = path.join(root, "ordinary-file");
  await writeFile(notDirectory, "not a directory");
  const brokenMarkerPath = path.join(notDirectory, "marker");
  const paths = pathsWithMarkers(brokenMarkerPath, brokenMarkerPath);

  await assert.rejects(applyPendingCacheClear(paths), { code: "ENOTDIR" });
  await assert.rejects(applyPendingGameStorageReset(paths, 1), { code: "ENOTDIR" });
});

test("a launcher full reset removes only global downloaded game data", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gw-full-reset-"));
  const marker = path.join(fixture, "clear-cache-on-start");
  const paths = {
    cacheClearRequest: marker,
    chunks: path.join(fixture, "game", "chunks"),
    artifacts: path.join(fixture, "game", "artifacts"),
    previousArtifacts: path.join(fixture, "game", "artifacts-previous"),
    rejectedClient: path.join(fixture, "game", "rejected-client.json"),
  } as GamePaths;
  const preserved = [
    path.join(fixture, "settings.json"),
    path.join(fixture, "launcher-state.json"),
    path.join(fixture, "build-library.json"),
    path.join(fixture, "multi", "workspace.json"),
    path.join(fixture, "multi", "profiles", "account", "templates.json"),
    path.join(fixture, "screenshots", "shot.jpg"),
    path.join(fixture, "chat-logs", "chat.txt"),
  ];
  try {
    for (const directory of [paths.chunks, paths.artifacts, paths.previousArtifacts]) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "owned"), "remove");
    }
    await writeFile(paths.rejectedClient, "remove");
    for (const file of preserved) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "keep");
    }
    await writeFile(marker, "launcher-full-reset-v1");

    await applyPendingCacheClear(paths);

    for (const removed of [paths.chunks, paths.artifacts, paths.previousArtifacts, paths.rejectedClient, marker]) {
      await assert.rejects(stat(removed), { code: "ENOENT" });
    }
    for (const file of preserved) assert.equal(await readFile(file, "utf8"), "keep");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
