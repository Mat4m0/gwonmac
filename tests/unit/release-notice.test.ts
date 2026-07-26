// Behaviour, executed: every case below drives the real module with a stubbed
// global `fetch` and asserts the value a caller receives. The property under
// test is that "we could not tell" never arrives dressed as "you are up to
// date", and that a button a user can mash spends at most one request per ten
// minutes.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { ReleaseNotice } from "../../src/shared/contracts.ts";

interface ReleaseNoticeModule {
  checkForNewerRelease(currentVersion: string): Promise<ReleaseNotice>;
}

// The ten-minute cache and the shared in-flight promise are module state, so
// every case gets its own instance rather than answering with the previous
// case's result.
let instances = 0;
async function freshModule(): Promise<ReleaseNoticeModule> {
  instances += 1;
  const loaded: unknown = await import(
    `../../src/main/release-notice.ts?case=${instances}`
  );
  return loaded as ReleaseNoticeModule;
}

type FetchImpl = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

const realFetch = globalThis.fetch;

function stubFetch(impl: FetchImpl): { urls: string[] } {
  const state = { urls: [] as string[] };
  globalThis.fetch = ((url: string, init: { signal: AbortSignal }) => {
    state.urls.push(url);
    return impl(url, init);
  }) as unknown as typeof globalThis.fetch;
  return state;
}

function releaseBody(tag: unknown, status = 200): Response {
  return new Response(JSON.stringify({ tag_name: tag }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function answers(tag: unknown, status = 200): FetchImpl {
  return () => Promise.resolve(releaseBody(tag, status));
}

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

describe("release notice", () => {
  it("asks GitHub for the latest release of this repository", async () => {
    const calls = stubFetch(answers("2026.7.0"));
    const { checkForNewerRelease } = await freshModule();

    await checkForNewerRelease("2026.7.0");

    assert.deepEqual(calls.urls, [
      "https://api.github.com/repos/Mat4m0/gwonmac/releases/latest",
    ]);
  });

  it("offers a newer release and renders the version from the parse", async () => {
    stubFetch(answers("v2026.8.0"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.7.0");

    assert.equal(notice.state, "update-available");
    assert.equal(notice.state === "update-available" && notice.latestVersion, "2026.8.0");
  });

  it("reports up to date when the published release is the running one", async () => {
    stubFetch(answers("2026.8.0"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state, "up-to-date");
  });

  it("does not offer a prerelease to an install running a stable build", async () => {
    stubFetch(answers("2026.9.0-rc.1"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state, "up-to-date");
  });

  it("offers a prerelease to an install already running one", async () => {
    stubFetch(answers("2026.9.0-rc.1"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.9.0-beta.2");

    assert.equal(notice.state, "update-available");
  });

  it("calls a build that is not on the release line unknown, and never asks", async () => {
    const calls = stubFetch(answers("2026.9.0"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("0.0.2-dev");

    assert.equal(notice.state, "unknown");
    assert.equal(notice.state === "unknown" && notice.reason, "unsupported-build");
    assert.equal(calls.urls.length, 0);
  });

  it("gives rate limiting its own reason", async () => {
    for (const status of [403, 429]) {
      stubFetch(answers("2026.9.0", status));
      const { checkForNewerRelease } = await freshModule();

      const notice = await checkForNewerRelease("2026.8.0");

      assert.equal(notice.state, "unknown");
      assert.equal(notice.state === "unknown" && notice.reason, "rate-limited");
    }
  });

  it("separates a server error from a rate limit", async () => {
    stubFetch(answers("2026.9.0", 500));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state === "unknown" && notice.reason, "server");
  });

  it("reports a failed request as unknown rather than up to date", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state, "unknown");
    assert.equal(notice.state === "unknown" && notice.reason, "offline");
  });

  it("reports a tag it cannot parse as unknown rather than up to date", async () => {
    for (const tag of ["banana", "2026.07.01", 20260701, undefined]) {
      stubFetch(answers(tag));
      const { checkForNewerRelease } = await freshModule();

      const notice = await checkForNewerRelease("2026.8.0");

      assert.equal(notice.state, "unknown");
      assert.equal(notice.state === "unknown" && notice.reason, "unreadable");
    }
  });

  it("reports a body that is not JSON as unknown", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>502</html>")));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state === "unknown" && notice.reason, "unreadable");
  });

  it("abandons a request that does not answer within five seconds", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    let requestStarted = () => {};
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          requestStarted();
        }),
    );
    const { checkForNewerRelease } = await freshModule();

    const pending = checkForNewerRelease("2026.8.0");
    await started;
    mock.timers.tick(5_000);
    const notice = await pending;

    assert.equal(notice.state, "unknown");
    assert.equal(notice.state === "unknown" && notice.reason, "timeout");
  });

  it("shares one request between callers asking at the same time", async () => {
    let release: (value: Response) => void = () => undefined;
    const calls = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { checkForNewerRelease } = await freshModule();

    const first = checkForNewerRelease("2026.8.0");
    const second = checkForNewerRelease("2026.8.0");
    release(releaseBody("2026.9.0"));

    assert.equal((await first).state, "update-available");
    assert.equal((await second).state, "update-available");
    assert.equal(calls.urls.length, 1);
  });

  it("answers a repeated ask from the cache instead of spending a request", async () => {
    const calls = stubFetch(answers("2026.9.0"));
    const { checkForNewerRelease } = await freshModule();

    const first = await checkForNewerRelease("2026.8.0");
    const second = await checkForNewerRelease("2026.8.0");

    assert.deepEqual(second, first);
    assert.equal(calls.urls.length, 1);
  });

  it("keeps refusing while rate limited rather than asking again", async () => {
    let status = 403;
    const calls = stubFetch(() => Promise.resolve(releaseBody("2026.9.0", status)));
    const { checkForNewerRelease } = await freshModule();

    await checkForNewerRelease("2026.8.0");
    status = 200;
    const second = await checkForNewerRelease("2026.8.0");

    assert.equal(second.state === "unknown" && second.reason, "rate-limited");
    assert.equal(calls.urls.length, 1);
  });

  it("retries after a transient failure instead of caching it", async () => {
    let fail = true;
    const calls = stubFetch(() =>
      fail
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(releaseBody("2026.9.0")),
    );
    const { checkForNewerRelease } = await freshModule();

    assert.equal((await checkForNewerRelease("2026.8.0")).state, "unknown");
    fail = false;
    assert.equal((await checkForNewerRelease("2026.8.0")).state, "update-available");
    assert.equal(calls.urls.length, 2);
  });

  it("asks again once the ten-minute cache has expired", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const calls = stubFetch(answers("2026.9.0"));
    const { checkForNewerRelease } = await freshModule();

    await checkForNewerRelease("2026.8.0");
    mock.timers.setTime(1_000_000 + 10 * 60 * 1_000 - 1);
    await checkForNewerRelease("2026.8.0");
    assert.equal(calls.urls.length, 1);

    mock.timers.setTime(1_000_000 + 10 * 60 * 1_000 + 1);
    const fresh = await checkForNewerRelease("2026.8.0");

    assert.equal(calls.urls.length, 2);
    assert.equal(fresh.checkedAt, 1_000_000 + 10 * 60 * 1_000 + 1);
  });
});
