import { expect, test } from "@playwright/test";
import path from "node:path";
import type { DownloadProgress } from "../../src/shared/contracts.js";
import {
  closeOffline,
  launchOffline,
  root,
} from "./fixtures.mjs";

const clientRuntimeModule = path.join(root, "build/main/client-runtime.js");
const patchClientModule = path.join(root, "build/main/core/patch-client.js");
const pathsModule = path.join(root, "build/main/core/paths.js");

test.describe("client generation coordination", () => {
  test("interrupts a slow update before renderer crash recovery takes the lock", async () => {
    const fixture = await launchOffline("gw-runtime-update-abort-e2e-");
    try {
      const result = await fixture.app.evaluate(
        async (_electron, modules) => {
          const fs = process.getBuiltinModule("node:fs/promises");
          const { createRequire } = process.getBuiltinModule("node:module");
          const os = process.getBuiltinModule("node:os");
          const path = process.getBuiltinModule("node:path");
          const require = createRequire(path.join(process.cwd(), "package.json"));
          const { ClientRuntime } = require(modules.clientRuntime);
          const { PatchClient } = require(modules.patchClient);
          const { gamePaths } = require(modules.paths);
          const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "gw-runtime-abort-probe-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.game, { recursive: true });
          const progress: DownloadProgress[] = [];
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: false,
            offlineShell: false,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              toolbox: false,
            },
            onProgress: (value: DownloadProgress) => progress.push(value),
            onPrefetch: () => undefined,
          });
          let updateSignal: AbortSignal | undefined;
          let started!: () => void;
          const updateStarted = new Promise<void>((resolve) => {
            started = resolve;
          });
          const originalUpdate = PatchClient.prototype.update;
          // `update(options?)` declares `signal` optional; the runtime always
          // supplies one, and abandoning the wait is what this stub exists for.
          PatchClient.prototype.update = async function controlledSlowUpdate(
            options: { signal: AbortSignal },
          ) {
            updateSignal = options.signal;
            started();
            await new Promise((_resolve, reject) => {
              const rejectAborted = () => reject(options.signal.reason);
              if (options.signal.aborted) {
                rejectAborted();
              } else {
                options.signal.addEventListener("abort", rejectAborted, {
                  once: true,
                });
              }
            });
          };

          try {
            const update = runtime.requestUpdate();
            await updateStarted;
            let deadline;
            const recovery = await Promise.race([
              runtime.recoverRendererCrash().then(() => "settled"),
              new Promise((resolve) => {
                deadline = setTimeout(() => resolve("timed-out"), 1_000);
              }),
            ]);
            clearTimeout(deadline);
            await update;
            return {
              recovery,
              updateAborted: updateSignal?.aborted ?? false,
              errorCodes: progress
                .filter((value) => value.phase === "error")
                .map((value) => value.errorCode),
            };
          } finally {
            PatchClient.prototype.update = originalUpdate;
            await runtime.shutdown();
            await fs.rm(root, { recursive: true, force: true });
          }
        },
        {
          clientRuntime: clientRuntimeModule,
          patchClient: patchClientModule,
          paths: pathsModule,
        },
      );

      expect(result.recovery).toBe("settled");
      expect(result.updateAborted).toBe(true);
      expect(result.errorCodes).toEqual(["not_ready"]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("shutdown aborts and joins an in-flight client update", async () => {
    const fixture = await launchOffline("gw-runtime-shutdown-abort-e2e-");
    try {
      const result = await fixture.app.evaluate(
        async (_electron, modules) => {
          const fs = process.getBuiltinModule("node:fs/promises");
          const { createRequire } = process.getBuiltinModule("node:module");
          const os = process.getBuiltinModule("node:os");
          const path = process.getBuiltinModule("node:path");
          const require = createRequire(path.join(process.cwd(), "package.json"));
          const { ClientRuntime } = require(modules.clientRuntime);
          const { PatchClient } = require(modules.patchClient);
          const { gamePaths } = require(modules.paths);
          const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "gw-runtime-shutdown-probe-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.game, { recursive: true });
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: false,
            offlineShell: false,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              toolbox: false,
            },
            onProgress: () => undefined,
            onPrefetch: () => undefined,
          });
          let updateSignal: AbortSignal | undefined;
          let started!: () => void;
          const updateStarted = new Promise<void>((resolve) => {
            started = resolve;
          });
          const originalUpdate = PatchClient.prototype.update;
          PatchClient.prototype.update = async function controlledUpdate(
            options: { signal: AbortSignal },
          ) {
            updateSignal = options.signal;
            started();
            await new Promise((_resolve, reject) => {
              const rejectAborted = () => reject(options.signal.reason);
              if (options.signal.aborted) rejectAborted();
              else {
                options.signal.addEventListener("abort", rejectAborted, {
                  once: true,
                });
              }
            });
          };

          try {
            const update = runtime.requestUpdate();
            await updateStarted;
            let deadline;
            const shutdown = await Promise.race([
              runtime.shutdown().then(() => "settled"),
              new Promise((resolve) => {
                deadline = setTimeout(() => resolve("timed-out"), 1_000);
              }),
            ]);
            clearTimeout(deadline);
            await update;
            return {
              shutdown,
              updateAborted: updateSignal?.aborted ?? false,
            };
          } finally {
            PatchClient.prototype.update = originalUpdate;
            await runtime.shutdown();
            await fs.rm(root, { recursive: true, force: true });
          }
        },
        {
          clientRuntime: clientRuntimeModule,
          patchClient: patchClientModule,
          paths: pathsModule,
        },
      );

      expect(result).toMatchObject({
        shutdown: "settled",
        updateAborted: true,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("does not start preparation after recovery aborts a queued update", async () => {
    const fixture = await launchOffline("gw-runtime-queued-abort-e2e-");
    try {
      const calls = await fixture.app.evaluate(
        async (_electron, modules) => {
          const fs = process.getBuiltinModule("node:fs/promises");
          const { createRequire } = process.getBuiltinModule("node:module");
          const os = process.getBuiltinModule("node:os");
          const path = process.getBuiltinModule("node:path");
          const require = createRequire(path.join(process.cwd(), "package.json"));
          const { ClientRuntime } = require(modules.clientRuntime);
          const { PatchClient } = require(modules.patchClient);
          const { gamePaths } = require(modules.paths);
          const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "gw-runtime-queued-abort-probe-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.game, { recursive: true });
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: false,
            offlineShell: false,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              toolbox: false,
            },
            onProgress: () => undefined,
            onPrefetch: () => undefined,
          });
          let updateCalls = 0;
          const originalUpdate = PatchClient.prototype.update;
          PatchClient.prototype.update = async () => {
            updateCalls += 1;
            throw new Error("queued update started");
          };
          let entered!: () => void;
          let release!: () => void;
          const lockEntered = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          const blocker = runtime.generationLock.run(async () => {
            entered();
            await held;
          });
          try {
            await lockEntered;
            const update = runtime.requestUpdate();
            const recovery = runtime.recoverRendererCrash();
            release();
            await Promise.all([blocker, update, recovery]);
            return updateCalls;
          } finally {
            PatchClient.prototype.update = originalUpdate;
            await runtime.shutdown();
            await fs.rm(root, { recursive: true, force: true });
          }
        },
        {
          clientRuntime: clientRuntimeModule,
          patchClient: patchClientModule,
          paths: pathsModule,
        },
      );

      expect(calls).toBe(0);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("rejects a stale renderer token after the active generation changes", async () => {
    const fingerprint = "a".repeat(64);
    const replacementFingerprint = "b".repeat(64);
    const fixture = await launchOffline("gw-runtime-confirm-race-e2e-");
    try {
      const result = await fixture.app.evaluate(
        async (_electron, modules) => {
          const fs = process.getBuiltinModule("node:fs/promises");
          const { createRequire } = process.getBuiltinModule("node:module");
          const os = process.getBuiltinModule("node:os");
          const path = process.getBuiltinModule("node:path");
          const require = createRequire(path.join(process.cwd(), "package.json"));
          const { ClientRuntime } = require(modules.clientRuntime);
          const { gamePaths } = require(modules.paths);
          const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "gw-runtime-confirm-probe-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.artifacts, { recursive: true });
          await fs.mkdir(paths.previousArtifacts, { recursive: true });
          await fs.writeFile(
            path.join(paths.artifacts, ".candidate.json"),
            JSON.stringify({
              formatVersion: 1,
              fingerprint: modules.fingerprint,
            }),
          );
          await fs.writeFile(
            path.join(paths.previousArtifacts, "rollback"),
            "preserved",
          );
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: false,
            offlineShell: true,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              toolbox: false,
            },
            onProgress: () => undefined,
            onPrefetch: () => undefined,
          });
          const store = {
            stop: () => undefined,
            saveTouched: async () => undefined,
          };
          const generation = runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store,
            snapshotMeta: {},
            wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
            jsPath: path.join(paths.artifacts, "Gw.jspi.js"),
            enhancementBuild: null,
          });
          const token = Object.freeze({
            generation: generation.generation,
            fingerprint: modules.fingerprint,
          });
          runtime.candidateHealthToken = token;

          let entered!: () => void;
          let release!: () => void;
          const lockEntered = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          const blocker = runtime.generationLock.run(async () => {
            entered();
            await held;
          });
          await lockEntered;
          const confirmation = runtime.confirmCandidateHealthy(token);

          const replacement = runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store,
            snapshotMeta: {},
            wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
            jsPath: path.join(paths.artifacts, "Gw.jspi.js"),
            enhancementBuild: null,
          });
          await fs.writeFile(
            path.join(paths.artifacts, ".candidate.json"),
            JSON.stringify({
              formatVersion: 1,
              fingerprint: modules.replacementFingerprint,
            }),
          );
          runtime.candidateHealthToken = Object.freeze({
            generation: replacement.generation,
            fingerprint: modules.replacementFingerprint,
          });
          release();
          await blocker;
          await confirmation;
          const marker = JSON.parse(
            await fs.readFile(
              path.join(paths.artifacts, ".candidate.json"),
              "utf8",
            ),
          );
          const rollback = await fs.readFile(
            path.join(paths.previousArtifacts, "rollback"),
            "utf8",
          );
          await runtime.shutdown();
          await fs.rm(root, { recursive: true, force: true });
          return {
            marker,
            rollback,
            healthToken: runtime.healthToken,
          };
        },
        {
          clientRuntime: clientRuntimeModule,
          paths: pathsModule,
          fingerprint,
          replacementFingerprint,
        },
      );

      expect(result.marker).toEqual({
        formatVersion: 1,
        fingerprint: replacementFingerprint,
      });
      expect(result.rollback).toBe("preserved");
      expect(result.healthToken).toEqual({
        generation: 2,
        fingerprint: replacementFingerprint,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("promotes only the exact active candidate token", async () => {
    const fingerprint = "c".repeat(64);
    const fixture = await launchOffline("gw-runtime-confirm-exact-e2e-");
    try {
      const result = await fixture.app.evaluate(
        async (_electron, modules) => {
          const fs = process.getBuiltinModule("node:fs/promises");
          const { createRequire } = process.getBuiltinModule("node:module");
          const os = process.getBuiltinModule("node:os");
          const path = process.getBuiltinModule("node:path");
          const require = createRequire(path.join(process.cwd(), "package.json"));
          const { ClientRuntime } = require(modules.clientRuntime);
          const { gamePaths } = require(modules.paths);
          const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "gw-runtime-exact-token-probe-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.artifacts, { recursive: true });
          await fs.mkdir(paths.previousArtifacts, { recursive: true });
          await fs.writeFile(
            path.join(paths.artifacts, ".candidate.json"),
            JSON.stringify({
              formatVersion: 1,
              fingerprint: modules.fingerprint,
            }),
          );
          await fs.writeFile(
            path.join(paths.previousArtifacts, "rollback"),
            "working",
          );
          await fs.writeFile(paths.rejectedClient, "old rejection");
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: false,
            offlineShell: true,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              toolbox: false,
            },
            onProgress: () => undefined,
            onPrefetch: () => undefined,
          });
          const store = {
            stop: () => undefined,
            saveTouched: async () => undefined,
          };
          const generation = runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store,
            snapshotMeta: {},
            wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
            jsPath: path.join(paths.artifacts, "Gw.jspi.js"),
            enhancementBuild: null,
          });
          const token = Object.freeze({
            generation: generation.generation,
            fingerprint: modules.fingerprint,
          });
          runtime.candidateHealthToken = token;

          await runtime.confirmCandidateHealthy({ ...token });
          const exists = async (target: string) =>
            fs.stat(target).then(
              () => true,
              () => false,
            );
          const outcome = {
            marker: await exists(
              path.join(paths.artifacts, ".candidate.json"),
            ),
            previous: await exists(paths.previousArtifacts),
            rejected: await exists(paths.rejectedClient),
            healthToken: runtime.healthToken,
          };
          await runtime.shutdown();
          await fs.rm(root, { recursive: true, force: true });
          return outcome;
        },
        {
          clientRuntime: clientRuntimeModule,
          paths: pathsModule,
          fingerprint,
        },
      );

      expect(result).toEqual({
        marker: false,
        previous: false,
        rejected: false,
        healthToken: null,
      });
    } finally {
      await closeOffline(fixture);
    }
  });
});
