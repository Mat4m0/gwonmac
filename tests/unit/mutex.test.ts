import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, describe, it } from "node:test";
import { Mutex } from "../../src/main/core/mutex.js";

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
    // …and the next queued operation runs anyway. With `.then(fn)` instead of
    // `.then(fn, fn)` this promise would never settle.
    assert.equal(await queued, "second finished");
    assert.deepEqual(ran, ["first", "second"]);
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
