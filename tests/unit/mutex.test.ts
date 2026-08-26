import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, describe, it } from "node:test";
import { Mutex } from "../../src/main/core/mutex.js";
import { loadSettings, saveSettings } from "../../src/main/core/settings.js";
import type { AppSettings, AppSettingsPatch } from "../../src/shared/contracts.js";

const scratchDirs: string[] = [];

after(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gw-mutex-"));
  scratchDirs.push(dir);
  return dir;
}

/**
 * The two generation directories `ClientRuntime` moves: `artifacts` is the one
 * the running client is served from, `artifacts.previous` is the rollback
 * target. Each holds a file naming the generation inside it, so a test can say
 * which one it is looking at rather than merely that a directory exists.
 */
async function generationTree(): Promise<string> {
  const root = await scratch();
  for (const [dir, generation] of [
    ["artifacts", "gen-1"],
    ["artifacts.previous", "gen-2"],
  ] as const) {
    await mkdir(join(root, dir));
    await writeFile(join(root, dir, "generation"), generation);
  }
  return root;
}

async function generationIn(dir: string): Promise<string> {
  return readFile(join(dir, "generation"), "utf8").catch(() => "missing");
}

/**
 * The shape every generation transition in `client-runtime.ts` has: move the
 * live directory aside, do work, move the rollback target into its place. The
 * `sleep` stands in for the real work — a `writeAtomicJson`, an `rm -rf`, or a
 * whole `PatchClient.update()` — and is what makes the window between the two
 * renames wide enough to be entered by anything not excluded from it.
 */
function rotateGenerations(
  root: string,
  label: string,
  log: string[],
): () => Promise<string> {
  return async () => {
    log.push(`${label}:enter`);
    const artifacts = join(root, "artifacts");
    const previous = `${artifacts}.previous`;
    const swap = `${artifacts}.swap`;
    const servedOnEntry = await generationIn(artifacts);
    await rename(artifacts, swap);
    await sleep(100);
    await rename(previous, artifacts);
    await rename(swap, previous);
    log.push(`${label}:exit`);
    return servedOnEntry;
  };
}

describe("generation mutex", () => {
  it("serialises real generation-directory moves", async () => {
    const root = await generationTree();
    const lock = new Mutex();
    const log: string[] = [];

    const served = await Promise.all([
      lock.run(rotateGenerations(root, "a", log)),
      lock.run(rotateGenerations(root, "b", log)),
      lock.run(rotateGenerations(root, "c", log)),
    ]);

    assert.deepEqual(log, [
      "a:enter",
      "a:exit",
      "b:enter",
      "b:exit",
      "c:enter",
      "c:exit",
    ]);
    // Nobody arrived while the live directory was moved aside, and each saw
    // the generation its predecessor left behind rather than "missing".
    assert.deepEqual(served, ["gen-1", "gen-2", "gen-1"]);
    assert.equal(await generationIn(join(root, "artifacts")), "gen-2");
    assert.equal(await generationIn(join(root, "artifacts.previous")), "gen-1");
    assert.equal(await generationIn(join(root, "artifacts.swap")), "missing");
  });

  it("tears the same tree when the moves are not serialised", async () => {
    const root = await generationTree();
    const log: string[] = [];

    // No lock: all three enter before any of them has moved anything, which is
    // exactly the interleaving an in-flight update, a candidate confirmation
    // and a renderer-crash rollback can produce today.
    const results = await Promise.allSettled([
      rotateGenerations(root, "a", log)(),
      rotateGenerations(root, "b", log)(),
      rotateGenerations(root, "c", log)(),
    ]);

    assert.deepEqual(log.slice(0, 3), ["a:enter", "b:enter", "c:enter"]);
    const failures = results.filter((r) => r.status === "rejected");
    // `artifacts` can only be moved aside once, so the two transitions that
    // lose the race fail mid-move — the rollback a crashed renderer is waiting
    // on throws instead of restoring anything.
    assert.equal(failures.length, 2);
    for (const failure of failures) {
      assert.match(String((failure as PromiseRejectedResult).reason), /ENOENT/);
    }
  });

  it("does not wedge the queue when a task rejects", async () => {
    const lock = new Mutex();
    const ran: string[] = [];

    const failed = lock.run(async () => {
      ran.push("first");
      throw new Error("rollback failed");
    });
    const queued = lock.run(async () => {
      ran.push("second");
      return "second finished";
    });

    // The caller of the failed task still sees its error…
    await assert.rejects(failed, /rollback failed/);

    const [outcome] = await Promise.allSettled([queued]);
    // …and the next queued operation runs anyway. That it *ran* is the property
    // that separates the two forms: with `.then(fn)` instead of `.then(fn, fn)`
    // the queued task is never invoked and its caller inherits the previous
    // task's rejection. It fails with "rollback failed"; it does not hang.
    assert.deepEqual(ran, ["first", "second"]);
    assert.deepEqual(outcome, { status: "fulfilled", value: "second finished" });
  });

  it("gives each caller its own task's result, in queue order", async () => {
    const lock = new Mutex();
    const finished: number[] = [];

    const results = await Promise.all(
      [30, 20, 10, 0].map((delayMs, index) =>
        lock.run(async () => {
          await sleep(delayMs);
          finished.push(index);
          return index * 2;
        }),
      ),
    );

    assert.deepEqual(results, [0, 2, 4, 6]);
    // Queue order, not completion order: task 0 sleeps longest and still runs
    // first.
    assert.deepEqual(finished, [0, 1, 2, 3]);
  });
});

describe("queue drain", () => {
  it("waits for the work already queued, failure included", async () => {
    const lock = new Mutex();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const failing = lock.run(async () => {
      await held;
      throw new Error("keychain write refused");
    });
    let drained = false;
    const drain = lock.settled.then(() => {
      drained = true;
    });

    await sleep(0);
    assert.equal(drained, false);
    release();
    await assert.rejects(failing, /keychain write refused/);
    // Quit waits for the write to stop touching the slot, not for it to have
    // succeeded: a drain that rejected would take the shutdown path down with
    // an error its caller has already been given.
    await drain;
    assert.equal(drained, true);
  });
});

/**
 * The shape every settings write in `main.ts` has: read the file, merge a
 * patch, write the whole object back. Hooks let the race test establish an
 * exact order without asking the scheduler to make one operation slower.
 */
function patchSettings(
  path: string,
  patch: AppSettingsPatch,
  hooks: {
    afterRead?: () => Promise<void>;
    afterSave?: () => void;
  } = {},
): () => Promise<AppSettings> {
  return async () => {
    const current = await loadSettings(path);
    await hooks.afterRead?.();
    const saved = await saveSettings(path, { ...current, ...patch });
    hooks.afterSave?.();
    return saved;
  };
}

describe("settings write queue", () => {
  it("keeps both patches when the writes are serialised", async () => {
    const path = join(await scratch(), "settings.json");
    const lock = new Mutex();

    await Promise.all([
      lock.run(patchSettings(path, { renderScale: 1 })),
      lock.run(patchSettings(path, { showDiagnostics: true })),
    ]);

    const settings = await loadSettings(path);
    assert.equal(settings.renderScale, 1);
    assert.equal(settings.showDiagnostics, true);
  });

  it("drops a patch when the same writes are not serialised", async () => {
    const path = join(await scratch(), "settings.json");
    let releaseFirst!: () => void;
    const secondSaved = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    // The same two patches without the lock. Both read before either writes,
    // so the slower one merges onto a value that never carried the faster
    // one's field and then writes the whole object over it. A player who
    // toggles two settings in the same moment keeps one of them.
    await Promise.all([
      patchSettings(path, { renderScale: 1 }, {
        afterRead: async () => secondSaved,
      })(),
      patchSettings(path, { showDiagnostics: true }, {
        afterSave: releaseFirst,
      })(),
    ]);

    const settings = await loadSettings(path);
    assert.equal(settings.renderScale, 1);
    assert.equal(settings.showDiagnostics, false);
  });

  it("writes the next patch after a write fails", async () => {
    const path = join(await scratch(), "settings.json");
    const lock = new Mutex();

    const failed = lock.run(async () => {
      throw new Error("settings volume is read-only");
    });
    const queued = lock.run(patchSettings(path, { renderScale: 1.5 }));

    await assert.rejects(failed, /read-only/);
    await queued;
    // A refused write costs its own caller an error and nothing more; the
    // queue behind it is not the place that failure is allowed to land.
    assert.equal((await loadSettings(path)).renderScale, 1.5);
  });
});
