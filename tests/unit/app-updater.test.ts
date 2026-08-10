import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AppUpdater,
  PERIODIC_CHECK_DUE_MS,
  PERIODIC_CHECK_TICK_MS,
  periodicCheckDue,
  type AppUpdateStage,
} from "../../src/main/app-updater.ts";
import type {
  AppUpdateErrorCode,
  AppUpdateState,
} from "../../src/shared/contracts.ts";

const repo = "https://github.com/Mat4m0/gwonmac";
const releaseApi =
  "https://api.github.com/repos/Mat4m0/gwonmac/releases?per_page=100";

function isReleaseApiRequest(input: RequestInfo | URL): boolean {
  return String(input) === releaseApi;
}

function release(version: string, options: {
  draft?: boolean;
  prerelease?: boolean;
  assets?: unknown[];
} = {}) {
  const tag = `v${version}`;
  const zipName = `Guild-Wars-Reforged-${version}-macOS-arm64.zip`;
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? version.includes("-"),
    assets: options.assets ?? [
      {
        name: "RELEASES.json",
        browser_download_url:
          `${repo}/releases/download/${tag}/RELEASES.json`,
      },
      {
        name: zipName,
        browser_download_url:
          `${repo}/releases/download/${tag}/${zipName}`,
      },
    ],
  };
}

function manifest(version: string) {
  const tag = `v${version}`;
  const zipName = `Guild-Wars-Reforged-${version}-macOS-arm64.zip`;
  return {
    url: `${repo}/releases/download/${tag}/${zipName}`,
    name: `Guild Wars Reforged v${version}`,
    version,
    tag,
    pub_date: "2026-07-30T00:00:00.000Z",
    notes: "",
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixture(options: {
  capable?: boolean;
  currentVersion?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  const states: AppUpdateState[] = [];
  const remembered: number[] = [];
  const feeds: string[] = [];
  const failures: { stage: AppUpdateStage; reason: AppUpdateErrorCode }[] = [];
  let nativeChecks = 0;
  let installs = 0;
  const updater = new AppUpdater({
    currentVersion: options.currentVersion ?? "2026.7.0-beta.1",
    capable: options.capable ?? true,
    fetch: options.fetch ?? (async (input) => {
      return isReleaseApiRequest(input)
        ? response([release("2026.7.0-beta.2")])
        : response(manifest("2026.7.0-beta.2"));
    }),
    now: () => 1234,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    nativeUpdater: {
      setFeedURL: ({ url }) => feeds.push(url),
      checkForUpdates: () => {
        nativeChecks += 1;
      },
      quitAndInstall: () => {
        installs += 1;
      },
    },
    rememberCheckedAt: async (value) => {
      remembered.push(value);
    },
    publish: (state) => states.push(state),
    recordFailure: (stage, reason) => failures.push({ stage, reason }),
  });
  return {
    updater,
    states,
    remembered,
    feeds,
    failures,
    nativeChecks: () => nativeChecks,
    installs: () => installs,
  };
}

describe("application updater", () => {
  it("recognizes only the exact GitHub releases API endpoint", () => {
    assert.equal(isReleaseApiRequest(releaseApi), true);
    assert.equal(
      isReleaseApiRequest(
        `https://attacker.invalid/?next=${encodeURIComponent(releaseApi)}`,
      ),
      false,
    );
    assert.equal(
      isReleaseApiRequest(
        "https://api.github.com.attacker.invalid/repos/Mat4m0/gwonmac/releases",
      ),
      false,
    );
    assert.equal(
      isReleaseApiRequest("https://attacker.invalid/api.github.com"),
      false,
    );
  });

  it("makes no request and reports unavailable without the signed marker", async () => {
    let requests = 0;
    const f = fixture({
      capable: false,
      fetch: async () => {
        requests += 1;
        return response([]);
      },
    });

    await f.updater.check();

    assert.equal(requests, 0);
    assert.deepEqual(f.updater.getState(), {
      phase: "failed",
      currentVersion: "2026.7.0-beta.1",
      lastCheckedAt: "1970-01-01T00:00:01.234Z",
      reason: "updater-unavailable",
    });
    assert.deepEqual(f.remembered, [1234]);
  });

  it("validates one release feed before asking Squirrel to download", async () => {
    const f = fixture();

    await f.updater.check();

    assert.equal(f.nativeChecks(), 1);
    assert.equal(f.feeds.length, 1);
    assert.deepEqual(f.remembered, [1234]);
    assert.equal(f.updater.getState().phase, "downloading");
    f.updater.updateDownloaded();
    assert.equal(f.updater.getState().phase, "ready");
    f.updater.quitAndInstall();
    f.updater.quitAndInstall();
    assert.equal(f.installs(), 1);
  });

  it("coalesces concurrent checks", async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    let requests = 0;
    const f = fixture({
      fetch: async (input) => {
        requests += 1;
        if (isReleaseApiRequest(input)) return pending;
        return response(manifest("2026.7.0-beta.2"));
      },
    });

    const first = f.updater.check();
    const second = f.updater.check();
    resolve(response([release("2026.7.0-beta.2")]));
    await Promise.all([first, second]);

    assert.equal(requests, 2);
    assert.equal(f.nativeChecks(), 1);
  });

  it("keeps stable installs off prereleases", async () => {
    const f = fixture({
      currentVersion: "2026.7.0",
      fetch: async () => response([
        release("2026.8.0-beta.1"),
        release("2026.7.0"),
      ]),
    });

    await f.updater.check();

    assert.deepEqual(f.updater.getState(), {
      phase: "up-to-date",
      currentVersion: "2026.7.0",
      latestVersion: "2026.7.0",
      checkedAt: "1970-01-01T00:00:01.234Z",
    });
    assert.equal(f.nativeChecks(), 0);
  });

  it("allows a release-identity prerelease to advance to stable", async () => {
    const f = fixture({
      fetch: async (input) => isReleaseApiRequest(input)
        ? response([
          release("2026.7.0"),
          release("2026.7.0-beta.2"),
        ])
        : response(manifest("2026.7.0")),
    });

    await f.updater.check();

    const state = f.updater.getState();
    assert.equal(
      state.phase === "downloading" && state.latestVersion,
      "2026.7.0",
    );
  });

  it("fails closed for duplicate manifests and mismatched feed contents", async () => {
    for (const badRelease of [
      release("2026.7.0-beta.2", {
        assets: [
          ...release("2026.7.0-beta.2").assets,
          {
            name: "RELEASES.json",
            browser_download_url:
              `${repo}/releases/download/v2026.7.0-beta.2/RELEASES.json`,
          },
        ],
      }),
      release("2026.7.0-beta.2"),
    ]) {
      const f = fixture({
        fetch: async (input) => isReleaseApiRequest(input)
          ? response([badRelease])
          : response({ ...manifest("2026.7.0-beta.2"), version: "2026.9.0" }),
      });
      await f.updater.check();
      const state = f.updater.getState();
      assert.equal(state.phase, "failed");
      assert.equal(
        state.phase === "failed" && state.reason,
        "feed-invalid",
      );
      assert.equal(f.nativeChecks(), 0);
    }
  });

  it("never presents transport failure as up to date", async () => {
    const f = fixture({
      fetch: async () => {
        throw new Error("offline");
      },
    });

    await f.updater.check();

    assert.deepEqual(f.updater.getState(), {
      phase: "failed",
      currentVersion: "2026.7.0-beta.1",
      lastCheckedAt: "1970-01-01T00:00:01.234Z",
      reason: "offline",
    });
    assert.deepEqual(f.failures, [{ stage: "releases", reason: "offline" }]);
  });

  it("records which request lost its answer, not only that one did", async () => {
    // The published state cannot say where a fault happened, so a check that
    // reached GitHub and lost the release's own feed would otherwise read
    // exactly like one that never reached GitHub at all.
    const f = fixture({
      fetch: async (input) => isReleaseApiRequest(input)
        ? response([release("2026.7.0-beta.2")])
        : new Response("<html>not json</html>", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await f.updater.check();

    assert.deepEqual(f.failures, [{ stage: "feed", reason: "unreadable" }]);
    assert.equal(f.updater.getState().phase, "failed");
    assert.equal(f.nativeChecks(), 0);
  });

  it("records an unreadable releases list against the releases request", async () => {
    const f = fixture({
      fetch: async () => new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    await f.updater.check();

    assert.deepEqual(f.failures, [{ stage: "releases", reason: "unreadable" }]);
  });

  it("names the request behind a body that parses but is not a releases list", async () => {
    const f = fixture({ fetch: async () => response({ message: "nope" }) });

    await f.updater.check();

    const state = f.updater.getState();
    assert.equal(state.phase === "failed" && state.reason, "unreadable");
    assert.deepEqual(f.failures, [{ stage: "releases", reason: "unreadable" }]);
  });

  it("keeps a rejected feed apart from a rejected release list", async () => {
    const f = fixture({
      fetch: async (input) => {
        if (isReleaseApiRequest(input)) {
          return response([release("2026.7.0-beta.2")]);
        }
        throw new Error("offline");
      },
    });

    await f.updater.check();

    assert.deepEqual(f.failures, [{ stage: "feed", reason: "offline" }]);
  });

  it("classifies a stalled release feed as a timeout", async () => {
    const f = fixture({
      timeoutMs: 1,
      fetch: async (input, init) => {
        if (isReleaseApiRequest(input)) {
          return response([release("2026.7.0-beta.2")]);
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      },
    });

    await f.updater.check();

    assert.deepEqual(f.updater.getState(), {
      phase: "failed",
      currentVersion: "2026.7.0-beta.1",
      lastCheckedAt: "1970-01-01T00:00:01.234Z",
      reason: "timeout",
    });
    assert.deepEqual(f.failures, [{ stage: "feed", reason: "timeout" }]);
  });

  it("does not duplicate work while downloading or ready", async () => {
    const f = fixture();
    await f.updater.check();
    await f.updater.check();
    f.updater.updateDownloaded();
    await f.updater.check();
    assert.equal(f.nativeChecks(), 1);
  });

  it("treats Squirrel refusing a prevalidated upgrade as a feed failure", async () => {
    const f = fixture();
    await f.updater.check();
    f.updater.updateNotAvailable();
    assert.deepEqual(f.updater.getState(), {
      phase: "failed",
      currentVersion: "2026.7.0-beta.1",
      lastCheckedAt: "1970-01-01T00:00:01.234Z",
      reason: "feed-invalid",
    });
  });
});

describe("periodic check policy", () => {
  const stale = (overrides: Partial<Parameters<typeof periodicCheckDue>[0]> = {}) => ({
    capable: true,
    autoCheckUpdates: true,
    activeSockets: 0,
    lastUpdateCheckAt: 0,
    now: PERIODIC_CHECK_DUE_MS,
    ...overrides,
  });

  it("never ticks an update-incapable build", () => {
    assert.equal(periodicCheckDue(stale({ capable: false })), false);
    assert.equal(
      periodicCheckDue(stale({ capable: false, lastUpdateCheckAt: null })),
      false,
    );
  });

  it("honors the opt-out at fire time, however stale the record", () => {
    assert.equal(periodicCheckDue(stale({ autoCheckUpdates: false })), false);
    assert.equal(
      periodicCheckDue(
        stale({ autoCheckUpdates: false, lastUpdateCheckAt: null }),
      ),
      false,
    );
  });

  it("defers while a game connection is open, however stale the record", () => {
    assert.equal(periodicCheckDue(stale({ activeSockets: 1 })), false);
    assert.equal(
      periodicCheckDue(stale({ activeSockets: 1, lastUpdateCheckAt: null })),
      false,
    );
  });

  it("checks immediately when no check has ever been recorded", () => {
    assert.equal(periodicCheckDue(stale({ lastUpdateCheckAt: null })), true);
  });

  it("becomes due exactly at the six-hour boundary", () => {
    assert.equal(
      periodicCheckDue(stale({ now: PERIODIC_CHECK_DUE_MS - 1 })),
      false,
    );
    assert.equal(periodicCheckDue(stale({ now: PERIODIC_CHECK_DUE_MS })), true);
  });

  it("recovers from a clock moved backwards instead of waiting it out", () => {
    assert.equal(
      periodicCheckDue(
        stale({ lastUpdateCheckAt: PERIODIC_CHECK_DUE_MS * 2, now: 0 }),
      ),
      true,
    );
    assert.equal(
      periodicCheckDue(stale({ lastUpdateCheckAt: 1, now: 0 })),
      false,
    );
  });

  it("keeps the declared cadence: 30-minute ticks against a six-hour window", () => {
    assert.equal(PERIODIC_CHECK_TICK_MS, 30 * 60 * 1000);
    assert.equal(PERIODIC_CHECK_DUE_MS, 6 * 60 * 60 * 1000);
    // A tick coarser than the window would silently stretch the promise.
    assert.ok(PERIODIC_CHECK_TICK_MS < PERIODIC_CHECK_DUE_MS);
  });
});
