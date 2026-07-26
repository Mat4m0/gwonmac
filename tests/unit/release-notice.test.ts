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

function release(
  tag: unknown,
  options: { draft?: boolean; prerelease?: boolean } = {},
) {
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
  };
}

function releaseBody(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function answers(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): FetchImpl {
  return () => Promise.resolve(releaseBody(body, status, headers));
}

function answersTags(...tags: unknown[]): FetchImpl {
  return answers(tags.map((tag) => release(tag)));
}

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

describe("release notice", () => {
  it("asks GitHub for a bounded release list from this repository", async () => {
    const calls = stubFetch(answersTags("2026.7.0"));
    const { checkForNewerRelease } = await freshModule();

    await checkForNewerRelease("2026.7.0");

    assert.deepEqual(calls.urls, [
      "https://api.github.com/repos/Mat4m0/gwonmac/releases?per_page=100",
    ]);
  });

  it("chooses the greatest stable release rather than trusting API order", async () => {
    stubFetch(
      answers([
        release("2026.8.0"),
        release("v2026.10.0"),
        release("2026.9.0"),
      ]),
    );
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.7.0");

    assert.equal(notice.state, "update-available");
    assert.equal(
      notice.state === "update-available" && notice.latestVersion,
      "2026.10.0",
    );
  });

  it("reports up to date when the published release is the running one", async () => {
    stubFetch(answersTags("2026.8.0"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state, "up-to-date");
  });

  it("does not offer a prerelease to an install running a stable build", async () => {
    // Unlike /releases/latest, the list includes prereleases. The stable
    // release is present too, so this fixture represents a real repository.
    stubFetch(answersTags("2026.9.0-rc.1", "2026.8.0"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state, "up-to-date");
  });

  it("honours GitHub's prerelease flag even when a tag looks stable", async () => {
    stubFetch(
      answers([
        release("2026.9.0", { prerelease: true }),
        release("2026.8.0"),
      ]),
    );
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state, "up-to-date");
  });

  it("chooses the greatest prerelease channel for a prerelease install", async () => {
    stubFetch(
      answersTags(
        "2026.9.0-beta.3",
        "2026.9.0-alpha.9",
        "2026.9.0-rc.1",
        "2026.8.0",
      ),
    );
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.9.0-alpha.1");

    assert.equal(notice.state, "update-available");
    assert.equal(
      notice.state === "update-available" && notice.latestVersion,
      "2026.9.0-rc.1",
    );
  });

  it("lets a prerelease install advance onto the stable release", async () => {
    stubFetch(answersTags("2026.9.0-rc.2", "2026.9.0"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.9.0-rc.1");

    assert.equal(notice.state, "update-available");
    assert.equal(
      notice.state === "update-available" && notice.latestVersion,
      "2026.9.0",
    );
  });

  it("calls a build that is not on the release line unknown, and never asks", async () => {
    const calls = stubFetch(answersTags("2026.9.0"));
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("0.0.2-dev");

    assert.equal(notice.state, "unknown");
    assert.equal(notice.state === "unknown" && notice.reason, "unsupported-build");
    assert.equal(calls.urls.length, 0);
  });

  it("gives real GitHub rate limits their own reason", async () => {
    for (const [status, headers] of [
      [429, {}],
      [403, { "x-ratelimit-remaining": "0" }],
      [403, { "retry-after": "60" }],
    ] as const) {
      stubFetch(answers([], status, headers));
      const { checkForNewerRelease } = await freshModule();

      const notice = await checkForNewerRelease("2026.8.0");

      assert.equal(notice.state, "unknown");
      assert.equal(notice.state === "unknown" && notice.reason, "rate-limited");
    }
  });

  it("does not mislabel an ordinary 403 as a rate limit", async () => {
    for (const headers of [{}, { "x-ratelimit-remaining": "12" }]) {
      stubFetch(answers([], 403, headers));
      const { checkForNewerRelease } = await freshModule();

      const notice = await checkForNewerRelease("2026.8.0");

      assert.equal(notice.state === "unknown" && notice.reason, "server");
    }
  });

  it("separates a server error from a rate limit", async () => {
    stubFetch(answers([], 500));
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

  it("reports a list with no readable release as unknown rather than up to date", async () => {
    for (const tag of ["banana", "2026.07.01", 20260701, undefined]) {
      stubFetch(answers([release(tag)]));
      const { checkForNewerRelease } = await freshModule();

      const notice = await checkForNewerRelease("2026.8.0");

      assert.equal(notice.state, "unknown");
      assert.equal(notice.state === "unknown" && notice.reason, "unreadable");
    }
  });

  it("skips drafts and malformed entries while selecting a valid release", async () => {
    stubFetch(
      answers([
        release("2027.1.0", { draft: true }),
        { tag_name: "banana", draft: false },
        null,
        release("2026.9.0"),
      ]),
    );
    const { checkForNewerRelease } = await freshModule();

    const notice = await checkForNewerRelease("2026.8.0");

    assert.equal(notice.state, "update-available");
    assert.equal(
      notice.state === "update-available" && notice.latestVersion,
      "2026.9.0",
    );
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
    let resolveFetch: (value: Response) => void = () => undefined;
    const calls = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { checkForNewerRelease } = await freshModule();

    const first = checkForNewerRelease("2026.8.0");
    const second = checkForNewerRelease("2026.8.0");
    resolveFetch(releaseBody([release("2026.9.0")]));

    assert.equal((await first).state, "update-available");
    assert.equal((await second).state, "update-available");
    assert.equal(calls.urls.length, 1);
  });

  it("answers a repeated ask from the cache instead of spending a request", async () => {
    const calls = stubFetch(answersTags("2026.9.0"));
    const { checkForNewerRelease } = await freshModule();

    const first = await checkForNewerRelease("2026.8.0");
    const second = await checkForNewerRelease("2026.8.0");

    assert.deepEqual(second, first);
    assert.equal(calls.urls.length, 1);
  });

  it("caches every network failure outcome for ten minutes", async () => {
    const failures = [
      {
        reason: "offline",
        answer: () => Promise.reject(new TypeError("fetch failed")),
      },
      {
        reason: "server",
        answer: () => Promise.resolve(releaseBody([], 500)),
      },
      {
        reason: "unreadable",
        answer: () => Promise.resolve(new Response("<html>not json</html>")),
      },
      {
        reason: "rate-limited",
        answer: () => Promise.resolve(releaseBody([], 429)),
      },
    ] as const;

    for (const failure of failures) {
      let firstRequest = true;
      const calls = stubFetch(() => {
        if (!firstRequest) {
          return Promise.resolve(releaseBody([release("2026.9.0")]));
        }
        firstRequest = false;
        return failure.answer();
      });
      const { checkForNewerRelease } = await freshModule();

      const first = await checkForNewerRelease("2026.8.0");
      const second = await checkForNewerRelease("2026.8.0");

      assert.equal(first.state === "unknown" && first.reason, failure.reason);
      assert.deepEqual(second, first);
      assert.equal(calls.urls.length, 1, failure.reason);
    }
  });

  it("asks again once the ten-minute cache has expired", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const calls = stubFetch(answersTags("2026.9.0"));
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
