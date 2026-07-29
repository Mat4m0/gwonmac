import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ClientRuntime } from "../../src/main/client-runtime.js";
import { ActiveClientSlot } from "../../src/main/core/active-client.js";
import type { ChunkStore } from "../../src/main/core/chunk-store.js";
import { Mutex } from "../../src/main/core/mutex.js";
import { PatchClient } from "../../src/main/core/patch-client.js";
import { appPaths } from "../../src/main/core/paths.js";
import type {
  ClientHealthToken,
  DownloadProgress,
} from "../../src/shared/contracts.js";

type RuntimeInternals = {
  readonly activeSlot: ActiveClientSlot;
  readonly generationLock: Mutex;
  candidateHealthToken: ClientHealthToken | null;
};

const noNetwork = async (): Promise<{ status: number; body: Uint8Array }> => {
  throw new Error("client coordination test attempted network access");
};

const snapshot = {
  size: 0,
  chunkSize: 1,
  chunkHashes: [],
  residentBits: new Uint8Array(),
};

const silentDiagnostics = {
  count: () => undefined,
  observe: () => undefined,
  gauge: () => undefined,
  peakGauge: () => undefined,
  logEvent: () => undefined,
  startClientUpdateSpan: () => ({
    traceId: "test",
    spanId: "test",
    end: () => 0,
  }),
};

function internals(runtime: ClientRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals;
}

function createRuntime(
  root: string,
  onProgress: (progress: DownloadProgress) => void = () => undefined,
  offlineShell = false,
): ClientRuntime {
  return new ClientRuntime({
    paths: appPaths(root),
    hostVersion: "test",
    cachedOnly: false,
    offlineShell,
    enhancementsEnabled: false,
    patchFetch: noNetwork,
    diagnostics: silentDiagnostics,
    onProgress,
    onPrefetch: () => undefined,
  });
}

async function temporaryRuntime(
  prefix: string,
  run: (runtime: ClientRuntime, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const runtime = createRuntime(root);
  try {
    await mkdir(appPaths(root).game, { recursive: true });
    await run(runtime, root);
  } finally {
    await runtime.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}

function controlledUpdate(
  onStart: (signal: AbortSignal) => void,
): typeof PatchClient.prototype.update {
  return async function update(options) {
    const signal = options?.signal;
    assert.ok(signal);
    onStart(signal);
    await new Promise((_resolve, reject) => {
      const aborted = () => reject(signal.reason);
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
    });
    throw new Error("unreachable update completion");
  };
}

function fakeStore(): ChunkStore {
  return {
    stop: () => undefined,
    saveTouched: async () => undefined,
  } as unknown as ChunkStore;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

describe("client generation coordination", () => {
  it("aborts an update before renderer recovery takes the generation lock", async () => {
    const progress: DownloadProgress[] = [];
    const root = await mkdtemp(path.join(tmpdir(), "gw-runtime-abort-"));
    const runtime = createRuntime(root, (value) => progress.push(value));
    await mkdir(appPaths(root).game, { recursive: true });
    let updateSignal: AbortSignal | undefined;
    let started!: () => void;
    const updateStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const original = PatchClient.prototype.update;
    PatchClient.prototype.update = controlledUpdate((signal) => {
      updateSignal = signal;
      started();
    });
    try {
      const update = runtime.requestUpdate();
      await updateStarted;
      await runtime.recoverRendererCrash();
      await update;
      assert.equal(updateSignal?.aborted, true);
      assert.deepEqual(
        progress
          .filter((value) => value.phase === "error")
          .map((value) => value.errorCode),
        ["not_ready"],
      );
    } finally {
      PatchClient.prototype.update = original;
      await runtime.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shutdown aborts and joins an in-flight update", async () => {
    await temporaryRuntime("gw-runtime-shutdown-", async (runtime) => {
      let updateSignal: AbortSignal | undefined;
      let started!: () => void;
      const updateStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const original = PatchClient.prototype.update;
      PatchClient.prototype.update = controlledUpdate((signal) => {
        updateSignal = signal;
        started();
      });
      try {
        const update = runtime.requestUpdate();
        await updateStarted;
        await runtime.shutdown();
        await update;
        assert.equal(updateSignal?.aborted, true);
      } finally {
        PatchClient.prototype.update = original;
      }
    });
  });

  it("does not prepare an update queued behind recovery", async () => {
    await temporaryRuntime("gw-runtime-queued-", async (runtime) => {
      let updateCalls = 0;
      const original = PatchClient.prototype.update;
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
      const blocker = internals(runtime).generationLock.run(async () => {
        entered();
        await held;
      });
      try {
        await lockEntered;
        const update = runtime.requestUpdate();
        const recovery = runtime.recoverRendererCrash();
        release();
        await Promise.all([blocker, update, recovery]);
        assert.equal(updateCalls, 0);
      } finally {
        PatchClient.prototype.update = original;
      }
    });
  });

  it("rejects a stale token after the active generation changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gw-runtime-stale-"));
    const paths = appPaths(root);
    const runtime = createRuntime(root, undefined, true);
    const fingerprint = "a".repeat(64);
    const replacementFingerprint = "b".repeat(64);
    try {
      await mkdir(paths.artifacts, { recursive: true });
      await mkdir(paths.previousArtifacts, { recursive: true });
      await writeFile(
        path.join(paths.artifacts, ".candidate.json"),
        JSON.stringify({ formatVersion: 1, fingerprint }),
      );
      await writeFile(
        path.join(paths.previousArtifacts, "rollback"),
        "preserved",
      );
      const value = internals(runtime);
      const generation = value.activeSlot.publish({
        artifactsDir: paths.artifacts,
        store: fakeStore(),
        snapshotMeta: snapshot,
        wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
        enhancementBuild: null,
      });
      const token = Object.freeze({
        generation: generation.generation,
        fingerprint,
      });
      value.candidateHealthToken = token;
      let entered!: () => void;
      let release!: () => void;
      const lockEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = value.generationLock.run(async () => {
        entered();
        await held;
      });
      await lockEntered;
      const confirmation = runtime.confirmCandidateHealthy(token);
      const replacement = value.activeSlot.publish({
        artifactsDir: paths.artifacts,
        store: fakeStore(),
        snapshotMeta: snapshot,
        wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
        enhancementBuild: null,
      });
      await writeFile(
        path.join(paths.artifacts, ".candidate.json"),
        JSON.stringify({
          formatVersion: 1,
          fingerprint: replacementFingerprint,
        }),
      );
      value.candidateHealthToken = Object.freeze({
        generation: replacement.generation,
        fingerprint: replacementFingerprint,
      });
      release();
      await blocker;
      await confirmation;
      assert.deepEqual(
        JSON.parse(
          await readFile(path.join(paths.artifacts, ".candidate.json"), "utf8"),
        ),
        { formatVersion: 1, fingerprint: replacementFingerprint },
      );
      assert.equal(
        await readFile(path.join(paths.previousArtifacts, "rollback"), "utf8"),
        "preserved",
      );
      assert.deepEqual(runtime.healthToken, {
        generation: 2,
        fingerprint: replacementFingerprint,
      });
    } finally {
      await runtime.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("promotes only the exact active candidate token", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gw-runtime-exact-"));
    const paths = appPaths(root);
    const runtime = createRuntime(root, undefined, true);
    const fingerprint = "c".repeat(64);
    try {
      await mkdir(paths.artifacts, { recursive: true });
      await mkdir(paths.previousArtifacts, { recursive: true });
      await writeFile(
        path.join(paths.artifacts, ".candidate.json"),
        JSON.stringify({ formatVersion: 1, fingerprint }),
      );
      await writeFile(
        path.join(paths.previousArtifacts, "rollback"),
        "working",
      );
      await writeFile(paths.rejectedClient, "old rejection");
      const value = internals(runtime);
      const generation = value.activeSlot.publish({
        artifactsDir: paths.artifacts,
        store: fakeStore(),
        snapshotMeta: snapshot,
        wasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
        enhancementBuild: null,
      });
      const token = Object.freeze({
        generation: generation.generation,
        fingerprint,
      });
      value.candidateHealthToken = token;
      await runtime.confirmCandidateHealthy({ ...token });
      assert.equal(
        await exists(path.join(paths.artifacts, ".candidate.json")),
        false,
      );
      assert.equal(await exists(paths.previousArtifacts), false);
      assert.equal(await exists(paths.rejectedClient), false);
      assert.equal(runtime.healthToken, null);
    } finally {
      await runtime.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
