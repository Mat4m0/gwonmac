import { expect, test } from "@playwright/test";
import path from "node:path";
import type { DownloadProgress } from "../../src/shared/contracts.js";
import {
  closeOffline,
  launchOffline,
  root,
} from "./fixtures.mjs";

const clientRuntimeModule = path.join(root, "build/main/client-runtime.js");
const chunkStoreModule = path.join(root, "build/main/core/chunk-store.js");
const patchClientModule = path.join(root, "build/main/core/patch-client.js");
const pathsModule = path.join(root, "build/main/core/paths.js");

test.describe("client generation coordination", () => {
  test("starts the complete download when a client becomes ready", async () => {
    const fixture = await launchOffline("gw-runtime-auto-download-e2e-");
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
          const root = await fs.mkdtemp(path.join(os.tmpdir(), "gw-runtime-auto-download-"));
          const paths = gamePaths(root);
          const progress: DownloadProgress[] = [];
          let downloads = 0;
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: true,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: (value: DownloadProgress) => progress.push(value),
          });
          const store = {
            chunksDir: paths.chunks,
            size: 400,
            chunkSize: 400,
            hashes: ["chunk"],
            resume: () => undefined,
            stop: () => undefined,
            residentIndices: async () => [0],
            chunkByteLength: () => 400,
            downloadAll: async ({ onProgress }: {
              onProgress: (value: {
                received: number;
                total: number;
                bytesPerSecond: number;
                secondsRemaining: number | null;
              }) => void;
            }) => {
              downloads += 1;
              onProgress({
                received: 400,
                total: 400,
                bytesPerSecond: 400,
                secondsRemaining: null,
              });
              return true;
            },
          };
          const active = runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store,
            wasmPath: "/active/Gw.jspi.wasm",
            jsPath: "/active/Gw.jspi.js",
            compatibility: null,
            extendedMemory: {
              requestedAtLaunch: false,
              status: "standard",
              effectiveCapBytes: 2_147_483_648,
              fallbackReason: null,
            },
          });
          runtime.clientReady(active);
          while (runtime.fullDownload) await runtime.fullDownload.promise;
          await runtime.shutdown();
          await fs.rm(root, { recursive: true, force: true });
          return {
            downloads,
            states: progress.flatMap((value) =>
              value.phase !== "error" && value.fullDownload
                ? [value.fullDownload.status]
                : []),
          };
        },
        { clientRuntime: clientRuntimeModule, paths: pathsModule },
      );
      expect(result).toEqual({
        downloads: 1,
        states: ["running", "running", "complete"],
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("owns snapshot metadata and cache capacity policy", async () => {
    const fixture = await launchOffline("gw-runtime-cache-policy-e2e-");
    try {
      const result = await fixture.app.evaluate(
        async (_electron, modules) => {
          const fs = process.getBuiltinModule("node:fs/promises");
          const { createRequire } = process.getBuiltinModule("node:module");
          const os = process.getBuiltinModule("node:os");
          const path = process.getBuiltinModule("node:path");
          const require = createRequire(path.join(process.cwd(), "package.json"));
          const { ClientRuntime } = require(modules.clientRuntime);
          const { FREE_MARGIN } = require(modules.chunkStore);
          const { gamePaths } = require(modules.paths);
          const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "gw-runtime-cache-policy-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.chunks, { recursive: true });
          const size = 10 ** 15;
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: true,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: () => undefined,
          });
          runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store: {
              chunksDir: paths.chunks,
              size,
              chunkSize: 400,
              hashes: ["first", "second", "third"],
              residentIndices: async () => [0, 2],
              residentBits: async () => Uint8Array.of(0b101),
              chunkByteLength: (index: number) => index === 2 ? 200 : 400,
              stop: () => undefined,
            },
            wasmPath: "/active/Gw.jspi.wasm",
            jsPath: "/active/Gw.jspi.js",
            compatibility: null,
            extendedMemory: {
              requestedAtLaunch: false,
              status: "standard",
              effectiveCapBytes: 2_147_483_648,
              fallbackReason: null,
            },
          });
          const [metadata, info] = await Promise.all([
            runtime.snapshotMetadata(),
            runtime.cacheInfo(),
          ]);
          await runtime.shutdown();
          await fs.rm(root, { recursive: true, force: true });
          return {
            metadata: {
              ...metadata,
              residentBits: [...metadata.residentBits],
            },
            info,
            expectedShortfall: Math.max(
              0,
              size - 600 + FREE_MARGIN - info.freeBytes,
            ),
          };
        },
        {
          clientRuntime: clientRuntimeModule,
          chunkStore: chunkStoreModule,
          paths: pathsModule,
        },
      );
      expect(result.metadata).toEqual({
        size: 10 ** 15,
        chunkSize: 400,
        chunkHashes: ["first", "second", "third"],
        residentBits: [0b101],
      });
      expect(result.info).toMatchObject({
        bytes: 600,
        chunks: 2,
        totalBytes: 10 ** 15,
        totalChunks: 3,
      });
      expect(result.info.freeBytes).toBeGreaterThanOrEqual(0);
      expect(result.info.fullDownloadShortfall).toBe(result.expectedShortfall);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("serves no client artifact before an active generation publishes", async () => {
    const fixture = await launchOffline("gw-runtime-no-active-artifacts-e2e-");
    try {
      // The cached-only startup publishes its final refusal asynchronously.
      // Cross that boundary before issuing protocol requests so a renderer
      // transition cannot destroy the evaluation that is reading them.
      await expect.poll(() => fixture.page.evaluate(async () =>
        window.gwNative.progress.current(),
      )).toMatchObject({ phase: "error", errorCode: "not_ready" });
      const responses = await fixture.page.evaluate(async () =>
        Promise.all(
          ["Gw.jspi.js", "Gw.jspi.wasm", "version.json"].map(async (name) => {
            const response = await fetch(`gw://app/${name}`);
            return {
              name,
              status: response.status,
              body: await response.text(),
            };
          }),
        ),
      );
      expect(responses).toEqual([
        { name: "Gw.jspi.js", status: 503, body: "client unavailable" },
        { name: "Gw.jspi.wasm", status: 503, body: "client unavailable" },
        { name: "version.json", status: 503, body: "client unavailable" },
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("refuses every ready progress emission until a client is active", async () => {
    const fixture = await launchOffline("gw-runtime-ready-invariant-e2e-");
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
            path.join(os.tmpdir(), "gw-runtime-ready-invariant-"),
          );
          const paths = gamePaths(root);
          const readyObservations: boolean[] = [];
          const runtime: InstanceType<typeof ClientRuntime> = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: true,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: (progress: DownloadProgress) => {
              if (progress.phase === "ready") {
                readyObservations.push(runtime.active !== null);
              }
            },
          });
          const preparingSession = runtime.session("test-app");
          let refusal: string | null = null;
          try {
            runtime.publishProgress({
              phase: "ready",
              received: 0,
              total: 0,
              label: "invalid",
            });
          } catch (error) {
            refusal = error instanceof Error && "code" in error
              ? String(error.code)
              : null;
          }
          const active = runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store: {
              stop: () => undefined,
            },
            wasmPath: "/active/Gw.jspi.wasm",
            jsPath: "/active/Gw.jspi.js",
            compatibility: null,
            extendedMemory: {
              requestedAtLaunch: false,
              status: "standard",
              effectiveCapBytes: 2_147_483_648,
              fallbackReason: null,
            },
          });
          runtime.candidateHealthToken = Object.freeze({
            generation: active.generation,
            fingerprint: "f".repeat(64),
          });
          const activeSession = runtime.session("test-app");
          runtime.publishProgress({
            phase: "ready",
            received: 0,
            total: 0,
            label: "valid",
          });
          await runtime.shutdown();
          await fs.rm(root, { recursive: true, force: true });
          return { refusal, readyObservations, preparingSession, activeSession };
        },
        { clientRuntime: clientRuntimeModule, paths: pathsModule },
      );
      expect(result).toEqual({
        refusal: "not_ready",
        readyObservations: [true],
        preparingSession: {
          appVersion: "test-app",
          compatibility: null,
          extendedMemory: null,
          healthToken: null,
        },
        activeSession: {
          appVersion: "test-app",
          compatibility: null,
          extendedMemory: {
            requestedAtLaunch: false,
            status: "standard",
            effectiveCapBytes: 2_147_483_648,
            fallbackReason: null,
          },
          healthToken: {
            generation: 1,
            fingerprint: "f".repeat(64),
          },
        },
      });
    } finally {
      await closeOffline(fixture);
    }
  });

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
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: (value: DownloadProgress) => progress.push(value),
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
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: () => undefined,
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
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: () => undefined,
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

  test("never starts patch publication after a client is active", async () => {
    const fixture = await launchOffline("gw-runtime-active-update-e2e-");
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
            path.join(os.tmpdir(), "gw-runtime-active-update-probe-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.artifacts, { recursive: true });
          const progress: DownloadProgress[] = [];
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: false,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: (value: DownloadProgress) => progress.push(value),
          });
          const activeStore = {
            stop: () => undefined,
          };
          runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store: activeStore,
            wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
            jsPath: path.join(paths.artifacts, "Gw.jspi.js"),
            compatibility: {
              clientSha256: "d".repeat(64),
              features: {
                gameFileSaving: { status: "available" },
                nativeCursor: { status: "off" },
                targetObservation: { status: "off" },
                partyObservation: { status: "off" },
                teamApply: { status: "off" },
              },
            },
            extendedMemory: {
              requestedAtLaunch: false,
              status: "standard",
              effectiveCapBytes: 2_147_483_648,
              fallbackReason: null,
            },
          });

          let patchCalls = 0;
          const originalUpdate = PatchClient.prototype.update;
          PatchClient.prototype.update = async () => {
            patchCalls += 1;
            throw new Error("active client reached PatchClient");
          };

          try {
            await runtime.requestUpdate();
            return {
              patchCalls,
              phases: progress.map((value) => value.phase),
              activeGeneration: runtime.active.generation,
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

      expect(result).toEqual({
        patchCalls: 0,
        phases: [],
        activeGeneration: 1,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps an untested candidate through the next startup update", async () => {
    const fingerprint = "e".repeat(64);
    const fixture = await launchOffline("gw-runtime-startup-rollback-e2e-");
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
            path.join(os.tmpdir(), "gw-runtime-startup-rollback-probe-"),
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
            path.join(paths.artifacts, "generation"),
            "candidate",
          );
          await fs.writeFile(
            path.join(paths.previousArtifacts, "generation"),
            "rollback",
          );
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: false,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: () => undefined,
          });
          const originalUpdate = PatchClient.prototype.update;
          let patchCalls = 0;
          let installedAtPatch = "";
          let blockedAtPatch: string | null = null;
          PatchClient.prototype.update = async function observeStartupUpdate(
            options: { blockedFingerprint?: string | null },
          ) {
            patchCalls += 1;
            installedAtPatch = await fs.readFile(
              path.join(paths.artifacts, "generation"),
              "utf8",
            );
            blockedAtPatch = options.blockedFingerprint ?? null;
            throw new Error("stop after rollback proof");
          };

          try {
            await runtime.requestUpdate();
            return {
              patchCalls,
              installedAtPatch,
              blockedAtPatch,
              rejected: await fs.stat(paths.rejectedClient).then(
                () => true,
                () => false,
              ),
              marker: JSON.parse(
                await fs.readFile(
                  path.join(paths.artifacts, ".candidate.json"),
                  "utf8",
                ),
              ),
              active: runtime.active,
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
          fingerprint,
        },
      );

      expect(result).toEqual({
        patchCalls: 1,
        installedAtPatch: "candidate",
        blockedAtPatch: null,
        rejected: false,
        marker: {
          formatVersion: 1,
          fingerprint,
        },
        active: null,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps active session facts while an unpublished preparation is refused", async () => {
    const fixture = await launchOffline("gw-runtime-unpublished-facts-e2e-");
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
            path.join(os.tmpdir(), "gw-runtime-unpublished-facts-probe-"),
          );
          const paths = gamePaths(root);
          await fs.mkdir(paths.artifacts, { recursive: true });
          const runtime = new ClientRuntime({
            paths,
            hostVersion: "test",
            cachedOnly: true,
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: () => undefined,
          });
          const store = {
            stop: () => undefined,
          };
          runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store,
            wasmPath: "/active/client.wasm",
            jsPath: "/active/client.js",
            compatibility: {
              clientSha256: "a".repeat(64),
              features: {
                gameFileSaving: { status: "available" },
                nativeCursor: { status: "available" },
                targetObservation: { status: "available" },
                partyObservation: { status: "available" },
                teamApply: { status: "available" },
              },
            },
            extendedMemory: {
              requestedAtLaunch: true,
              status: "active",
              effectiveCapBytes: 4_294_967_296,
              fallbackReason: null,
            },
          });

          const prepared = await runtime.selectClientWasm();
          const outcome = {
            preparedCompatibility: prepared.compatibility,
            preparedExtendedMemory: prepared.extendedMemory,
            activeCompatibility: runtime.compatibility,
            activeExtendedMemory: runtime.extendedMemory,
            session: runtime.session("test-app"),
          };
          await runtime.shutdown();
          await fs.rm(root, { recursive: true, force: true });
          return outcome;
        },
        {
          clientRuntime: clientRuntimeModule,
          paths: pathsModule,
        },
      );

      expect(result.preparedCompatibility).toBeNull();
      expect(result.preparedExtendedMemory.status).toBe("standard");
      expect(result.activeCompatibility).toMatchObject({
        clientSha256: "a".repeat(64),
        features: { teamApply: { status: "available" } },
      });
      expect(result.activeExtendedMemory).toMatchObject({
        status: "active",
        effectiveCapBytes: 4_294_967_296,
      });
      expect(result.session).toMatchObject({
        appVersion: "test-app",
        compatibility: {
          clientSha256: "a".repeat(64),
        },
        extendedMemory: {
          status: "active",
          effectiveCapBytes: 4_294_967_296,
        },
        healthToken: null,
      });
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
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: () => undefined,
          });
          const store = {
            stop: () => undefined,
          };
          const generation = runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store,
            wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
            jsPath: path.join(paths.artifacts, "Gw.jspi.js"),
            compatibility: {
              clientSha256: "1".repeat(64),
              features: {
                gameFileSaving: { status: "available" },
                nativeCursor: { status: "off" },
                targetObservation: { status: "off" },
                partyObservation: { status: "off" },
                teamApply: { status: "off" },
              },
            },
            extendedMemory: {
              requestedAtLaunch: false,
              status: "standard",
              effectiveCapBytes: 2_147_483_648,
              fallbackReason: null,
            },
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
            wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
            jsPath: path.join(paths.artifacts, "Gw.jspi.js"),
            compatibility: {
              clientSha256: "2".repeat(64),
              features: {
                gameFileSaving: { status: "unavailable", reason: "game-update" },
                nativeCursor: { status: "off" },
                targetObservation: { status: "off" },
                partyObservation: { status: "off" },
                teamApply: { status: "off" },
              },
            },
            extendedMemory: {
              requestedAtLaunch: true,
              status: "unavailable",
              effectiveCapBytes: 2_147_483_648,
              fallbackReason: "unsupported-client",
            },
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
            extendedMemoryEnabled: false,
            enhancementCapabilities: {
              nativeCursor: false,
              targetObservation: false,
              partyObservation: false,
            },
            onProgress: () => undefined,
          });
          const store = {
            stop: () => undefined,
          };
          const generation = runtime.activeSlot.publish({
            artifactsDir: paths.artifacts,
            store,
            wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
            jsPath: path.join(paths.artifacts, "Gw.jspi.js"),
            compatibility: {
              clientSha256: "3".repeat(64),
              features: {
                gameFileSaving: { status: "available" },
                nativeCursor: { status: "off" },
                targetObservation: { status: "off" },
                partyObservation: { status: "off" },
                teamApply: { status: "off" },
              },
            },
            extendedMemory: {
              requestedAtLaunch: false,
              status: "standard",
              effectiveCapBytes: 2_147_483_648,
              fallbackReason: null,
            },
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
