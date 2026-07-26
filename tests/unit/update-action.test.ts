// Executes the renderer's update action: the three states it may report, the
// sentence it picks for each failure reason, the single request a mashed
// button is allowed to make, and what it persists.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindUpdateActionDom,
  createUpdateAction,
  describeReleaseNotice,
  formatLastChecked,
} from "../../src/renderer/update-action.js";
import type {
  ReleaseCheckFailure,
  ReleaseNotice,
} from "../../src/shared/contracts.js";

type View = {
  actionLabel: string;
  busy: boolean;
  message: string;
  lastChecked: string;
  updateAvailable: boolean;
};

class FakeElement extends EventTarget {
  textContent = "";
  hidden = false;
  disabled = false;

  click() {
    const event = new Event("click", { cancelable: true });
    this.dispatchEvent(event);
    return event;
  }
}

const UPDATE_ELEMENT_IDS = [
  "loading-update-check",
  "loading-update-status",
  "loading-update-when",
  "loading-update-get",
  "settings-check-updates",
  "settings-open-releases",
  "settings-update-status",
  "settings-update-when",
  "client-compat-check",
  "client-compat-releases",
  "client-compat-update",
] as const;

function updateDom() {
  // Keyed by `string`, because that is what a document is: `getElementById`
  // may be handed any id at all, and the answer for one this fake does not
  // hold is the same `null` the real DOM gives. Only `element` below is
  // restricted to the eleven ids, so a test still cannot ask for one the
  // renderer never binds.
  const elements = new Map<string, FakeElement>(
    UPDATE_ELEMENT_IDS.map((id) => [id, new FakeElement()]),
  );
  const root = {
    getElementById: (id: string) => elements.get(id) ?? null,
  } as unknown as Document;
  return {
    root,
    element: (id: (typeof UPDATE_ELEMENT_IDS)[number]) => {
      const result = elements.get(id);
      assert.ok(result);
      return result;
    },
  };
}

const REASONS: ReleaseCheckFailure[] = [
  "rate-limited",
  "offline",
  "timeout",
  "server",
  "unreadable",
  "unsupported-build",
];

const unknown = (
  reason: ReleaseCheckFailure,
  checkedAt = 1_000,
): ReleaseNotice => ({
  state: "unknown",
  currentVersion: "2026.7.0",
  reason,
  checkedAt,
});

/** A controller plus the views it published, in order. */
function harness(
  answers: (() => Promise<ReleaseNotice>)[],
  options: { now?: number; remember?: (at: number) => Promise<unknown> } = {},
) {
  const remembered: number[] = [];
  let calls = 0;
  const views: View[] = [];
  const action = createUpdateAction({
    check: () => {
      const answer = answers[calls] ?? answers.at(-1);
      calls += 1;
      if (!answer) throw new Error("no answer configured");
      return answer();
    },
    remember:
      options.remember ??
      (async (at: number) => {
        remembered.push(at);
      }),
    now: () => options.now ?? 60_000,
  });
  action.subscribe((view: View) => views.push(view));
  return {
    action,
    views,
    remembered,
    latest: () => views.at(-1) as View,
    calls: () => calls,
  };
}

describe("release notice copy", () => {
  it("names the version that is available", () => {
    assert.equal(
      describeReleaseNotice({
        state: "update-available",
        currentVersion: "2026.7.0",
        latestVersion: "2026.8.0",
        checkedAt: 1,
      }),
      "Version 2026.8.0 is available.",
    );
  });

  it("gives every failure reason its own sentence, and none of them claims an answer", () => {
    const sentences = REASONS.map((reason) => describeReleaseNotice(unknown(reason)));
    assert.equal(new Set(sentences).size, REASONS.length);
    for (const sentence of sentences) {
      assert.match(sentence, /^Couldn't check/);
      // The failure that must never read as an answer.
      assert.doesNotMatch(sentence, /latest version/i);
    }
  });

  it("separates a rate limit from a server error, because a button invites mashing", () => {
    assert.notEqual(
      describeReleaseNotice(unknown("rate-limited")),
      describeReleaseNotice(unknown("server")),
    );
  });
});

describe("last checked", () => {
  const at = 1_000_000_000_000;
  it("says nothing at all when GitHub has never been asked", () => {
    assert.equal(formatLastChecked(null, at), "");
  });

  it("counts in the largest unit that is still true", () => {
    assert.equal(formatLastChecked(at, at + 59_000), "Last checked just now");
    assert.equal(formatLastChecked(at, at + 60_000), "Last checked 1 minute ago");
    assert.equal(formatLastChecked(at, at + 120_000), "Last checked 2 minutes ago");
    assert.equal(formatLastChecked(at, at + 3_600_000), "Last checked 1 hour ago");
    assert.equal(formatLastChecked(at, at + 7_200_000), "Last checked 2 hours ago");
    assert.equal(formatLastChecked(at, at + 86_400_000), "Last checked 1 day ago");
    assert.equal(formatLastChecked(at, at + 5 * 86_400_000), "Last checked 5 days ago");
  });

  it("does not report a check in the future when the clock disagrees", () => {
    assert.equal(formatLastChecked(at, at - 86_400_000), "Last checked just now");
  });
});

describe("update action", () => {
  it("starts with no answer and no history", () => {
    const { latest } = harness([]);
    assert.deepEqual(latest(), {
      actionLabel: "Check for Updates",
      busy: false,
      message: "",
      lastChecked: "",
      updateAvailable: false,
    });
  });

  it("offers the releases link only when an upgrade is on offer", async () => {
    const available: ReleaseNotice = {
      state: "update-available",
      currentVersion: "2026.7.0",
      latestVersion: "2026.8.0",
      checkedAt: 30_000,
    };
    const one = harness([async () => available]);
    await one.action.check();
    assert.equal(one.latest().updateAvailable, true);
    assert.equal(one.latest().message, "Version 2026.8.0 is available.");

    const two = harness([
      async () => ({
        state: "up-to-date",
        currentVersion: "2026.8.0",
        latestVersion: "2026.8.0",
        checkedAt: 30_000,
      }),
    ]);
    await two.action.check();
    assert.equal(two.latest().updateAvailable, false);
    assert.equal(two.latest().message, "You're on the latest version.");
  });

  it("persists the check attempt, including when its answer was a failure", async () => {
    const { action, remembered, latest } = harness([
      async () => unknown("offline", 30_000),
    ]);
    await action.check();
    assert.deepEqual(remembered, [30_000]);
    assert.equal(latest().lastChecked, "Last checked just now");
    assert.equal(latest().message, describeReleaseNotice(unknown("offline")));
  });

  it("keeps a cached answer's own timestamp rather than claiming a fresh request", async () => {
    // Main answers a repeated click from its ten-minute cache, and the cached
    // notice carries the time of the check that produced it.
    const cached: ReleaseNotice = {
      state: "up-to-date",
      currentVersion: "2026.8.0",
      latestVersion: "2026.8.0",
      checkedAt: 0,
    };
    const { action, latest, remembered } = harness([async () => cached], {
      now: 600_000,
    });
    await action.check();
    assert.equal(latest().lastChecked, "Last checked 10 minutes ago");
    assert.deepEqual(remembered, [0]);
  });

  it("makes one request for concurrent asks and reports being busy in between", async () => {
    const pending: ((notice: ReleaseNotice) => void)[] = [];
    const { action, latest, calls } = harness([
      () =>
        new Promise<ReleaseNotice>((resolve) => {
          pending.push(resolve);
        }),
    ]);
    const first = action.check();
    const second = action.check();
    assert.equal(calls(), 1, "a second ask must not become a second request");
    assert.equal(latest().busy, true);
    assert.equal(latest().actionLabel, "Checking…");
    assert.equal(pending.length, 1);
    pending[0]?.(unknown("timeout", 30_000));
    await Promise.all([first, second]);
    assert.equal(latest().busy, false);
    assert.equal(calls(), 1);

    // The single-flight rule is not a permanent lock: the next ask is a real
    // ask again. (Left in flight on purpose; main owns the ten-minute cache.)
    void action.check();
    assert.equal(calls(), 2);
  });

  it("reports a bridge failure as a failure, never as up to date", async () => {
    const { action, latest, remembered } = harness([
      async () => {
        throw new Error("ipc is gone");
      },
    ]);
    await action.check();
    assert.match(latest().message, /^Couldn't check/);
    assert.doesNotMatch(latest().message, /latest version/i);
    assert.equal(latest().updateAvailable, false);
    assert.equal(latest().busy, false);
    // No release-check result crossed the broken bridge, so there is no
    // trustworthy completion time to persist.
    assert.deepEqual(remembered, []);
    assert.equal(latest().lastChecked, "");
  });

  it("recovers from a bridge that throws synchronously instead of rejecting", async () => {
    // `window.gwNative.releaseNotice.check()` throws where it stands when the
    // bridge property is missing. If that throw settles the operation before
    // the action records it as running, the action latches busy: every surface
    // reads "Checking…" and disabled for the rest of the session.
    const { action, latest, calls } = harness([
      () => {
        throw new TypeError("cannot read properties of undefined");
      },
      async () => unknown("offline", 30_000),
    ]);
    await action.check();
    assert.equal(latest().busy, false);
    assert.equal(latest().actionLabel, "Check for Updates");
    assert.match(latest().message, /^Couldn't check/);

    await action.check();
    assert.equal(calls(), 2, "the next ask must be a real ask again");
    assert.equal(latest().message, describeReleaseNotice(unknown("offline")));
  });

  it("still shows the answer when the settings write fails", async () => {
    const { action, latest } = harness(
      [
        async () => ({
          state: "up-to-date",
          currentVersion: "2026.8.0",
          latestVersion: "2026.8.0",
          checkedAt: 30_000,
        }),
      ],
      {
        remember: async () => {
          throw new Error("disk is full");
        },
      },
    );
    await action.check();
    assert.equal(latest().message, "You're on the latest version.");
    assert.equal(latest().lastChecked, "Last checked just now");
  });

  it("renders the timestamp restored from settings before anything is asked", () => {
    const { action, latest } = harness([], { now: 3_600_000 });
    action.restore(0);
    assert.equal(latest().lastChecked, "Last checked 1 hour ago");
    assert.equal(latest().message, "");
  });

  it("binds one view and one action to all three fixed DOM surfaces", () => {
    const dom = updateDom();
    let listener: (view: View) => void = () => undefined;
    let checks = 0;
    let releases = 0;
    const action = {
      subscribe(next: (view: View) => void) {
        listener = next;
      },
      restore() {},
      async check() {
        checks += 1;
      },
    };

    bindUpdateActionDom(dom.root, action, async () => {
      releases += 1;
    });
    listener({
      actionLabel: "Checking…",
      busy: true,
      message: "Version 2026.8.0 is available.",
      lastChecked: "Last checked just now",
      updateAvailable: true,
    });

    for (const id of [
      "loading-update-check",
      "settings-check-updates",
      "client-compat-check",
    ] as const) {
      assert.equal(dom.element(id).textContent, "Checking…");
    }
    assert.equal(dom.element("settings-check-updates").disabled, true);
    assert.equal(dom.element("client-compat-check").disabled, true);
    assert.equal(dom.element("loading-update-status").hidden, false);
    assert.equal(dom.element("settings-update-status").hidden, false);
    assert.equal(dom.element("client-compat-update").hidden, false);
    assert.equal(dom.element("loading-update-get").hidden, false);
    assert.equal(dom.element("settings-open-releases").hidden, false);

    const launcherClick = dom.element("loading-update-check").click();
    dom.element("settings-check-updates").click();
    dom.element("client-compat-check").click();
    dom.element("settings-open-releases").click();
    dom.element("client-compat-releases").click();
    assert.equal(launcherClick.defaultPrevented, true);
    assert.equal(checks, 3);
    assert.equal(releases, 2);
  });
});
