// A quit request is answered by cancelling the quit and running cleanup, so
// for as long as cleanup runs the application is still on screen and the Cmd+Q
// that started it has already been consumed. Two of the registered tasks are
// bounded by nothing of their own — the renderer filesystem sync and the client
// shutdown's in-flight game update — and the field record in
// `internal/upstream/memory-exhaustion-log.md` says the sync fails on every
// observed quit. This executes the real pass to prove a stuck task cannot hold
// the process, and that a quit which ran out of time says so instead of
// leaving the next launch to read the missing completion as a crash.
//
// `lifecycle.ts` imports Electron and the diagnostics entry point, neither of
// which `node --test` has, so the loader below answers both. The diagnostics
// stub is what the assertions read: the events are the contract, not a return
// value.
import assert from "node:assert/strict";
import { register } from "node:module";
import test, { mock } from "node:test";

const recorded: string[] = [];
const flushes: string[] = [];
(globalThis as {
  __quitEvents?: string[];
  __quitFlushes?: string[];
}).__quitEvents = recorded;
(globalThis as { __quitFlushes?: string[] }).__quitFlushes = flushes;

register(
  `data:text/javascript,${encodeURIComponent(
    `export function resolve(specifier, context, next) {
       if (specifier === "electron") {
         return {
           url: "data:text/javascript,export const app = { on(){}, exit(){}, quit(){}, enableSandbox(){} };",
           format: "module",
           shortCircuit: true,
         };
       }
       if (specifier.endsWith("/diagnostics.js")) {
         return {
           url: "data:text/javascript," + encodeURIComponent(
             "export const logEvent = (e) => { globalThis.__quitEvents.push(e.k); };" +
             "export const flushDiagnostics = () => new Promise(() => { globalThis.__quitFlushes.push('started'); });",
           ),
           format: "module",
           shortCircuit: true,
         };
       }
       return next(specifier, context);
     }`,
  )}`,
);

const { onAppQuit, runQuitCleanup, QUIT_CLEANUP_DEADLINE_MS, isQuitting } =
  await import("../../src/main/lifecycle.ts");

test("neither a stuck cleanup task nor a stuck final flush can hold the quit", async () => {
  const ran: string[] = [];
  // Registration order is reversed at run time, so this one runs last —
  // the position the renderer filesystem sync actually occupies.
  onAppQuit(() => new Promise<void>(() => { ran.push("stuck"); }));
  onAppQuit(() => { ran.push("first"); });

  // The deadline is the production one; only the clock is faked, so the test
  // costs nothing and still asserts against the value that ships.
  mock.timers.enable({ apis: ["setTimeout"] });
  const pass = runQuitCleanup();
  let settled = false;
  void pass.then(() => { settled = true; });

  mock.timers.tick(QUIT_CLEANUP_DEADLINE_MS - 1);
  await Promise.resolve();
  assert.equal(settled, false, "the pass waits for its tasks up to the deadline");

  mock.timers.tick(1);
  await pass;
  mock.timers.reset();

  assert.deepEqual(ran, ["first", "stuck"], "every task still gets its turn");
  assert.deepEqual(
    recorded,
    ["quit.cleanupStarted", "quit.cleanupTimedOut"],
    "a quit that ran out of time is recorded as that, not as a completion",
  );
  assert.ok(!recorded.includes("quit.cleanupCompleted"),
    "the crash heuristic reads the completion, so a timeout must not claim one");
  assert.deepEqual(
    flushes,
    ["started"],
    "the final diagnostic write is attempted without escaping the deadline",
  );
  assert.equal(isQuitting(), true);
});
