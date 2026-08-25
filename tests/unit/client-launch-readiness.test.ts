/** Replacement renderers must not confuse background data download with boot. */
import assert from "node:assert/strict";
import test from "node:test";
import type {
  ClientSession,
  DownloadProgress,
} from "../../src/shared/contracts.js";
import { launchProgressForSession } from "../../src/renderer/client-launch-readiness.js";

const preparing: ClientSession = {
  appVersion: "test",
  compatibility: null,
  extendedMemory: null,
  healthToken: null,
};
const active: ClientSession = {
  appVersion: "test",
  compatibility: null,
  extendedMemory: {
    requestedAtLaunch: false,
    status: "standard",
    effectiveCapBytes: 2_147_483_648,
    fallbackReason: null,
  },
  healthToken: null,
};
const backgroundDownload: DownloadProgress = {
  phase: "image",
  label: "Downloading full game",
  received: 16,
  total: 64,
  bytesPerSecond: 8,
  secondsRemaining: 6,
  fullDownload: { status: "running" },
};

test("an active client boots while its complete data downloads", () => {
  assert.deepEqual(
    launchProgressForSession(backgroundDownload, active),
    {
      ...backgroundDownload,
      phase: "ready",
      label: "Starting Guild Wars",
    },
  );
});

test("preparation and failure remain launch gates", () => {
  assert.equal(
    launchProgressForSession(backgroundDownload, preparing),
    backgroundDownload,
  );
  const failure: DownloadProgress = { phase: "error", errorCode: "not_ready" };
  assert.equal(launchProgressForSession(failure, active), failure);
  for (const phase of ["checking", "client"] as const) {
    const preparation: DownloadProgress = { ...backgroundDownload, phase };
    assert.equal(launchProgressForSession(preparation, active), preparation);
  }
});
