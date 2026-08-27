// A missing reset marker is the normal no-op startup path. Any other stat
// failure means startup cannot know whether a durable destructive request is
// pending, so it must stay visible instead of being misclassified as absent.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
       if (specifier.endsWith("/window.js")) {
         return module("export const resetWindowState = async () => {};");
       }
       return next(specifier, context);
     }`,
  )}`,
);

const { applyPendingCacheClear, applyPendingGameStorageReset, settingsResetDetail } =
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

test("reset copy matches the data owner available at launch", () => {
  assert.match(settingsResetDetail(false), /Stored Build Library and Travel/u);
  assert.doesNotMatch(settingsResetDetail(false), /Travel shortcuts.*return to their defaults/u);
  assert.match(settingsResetDetail(true), /Travel shortcuts.*return to their defaults/u);
  assert.doesNotMatch(settingsResetDetail(true), /remain/u);
});

test("marker inspection failures other than ENOENT remain visible", async () => {
  const notDirectory = path.join(root, "ordinary-file");
  await writeFile(notDirectory, "not a directory");
  const brokenMarkerPath = path.join(notDirectory, "marker");
  const paths = pathsWithMarkers(brokenMarkerPath, brokenMarkerPath);

  await assert.rejects(applyPendingCacheClear(paths), { code: "ENOTDIR" });
  await assert.rejects(applyPendingGameStorageReset(paths, 1), { code: "ENOTDIR" });
});
