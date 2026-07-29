import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { shutdownFixtureProcess } from "../electron/fixtures.mts";

class FakeProcess extends EventEmitter {
  readonly pid = undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: (NodeJS.Signals | number | undefined)[] = [];
  private readonly exitOn: "close" | "terminate" | "kill";

  constructor(exitOn: "close" | "terminate" | "kill") {
    super();
    this.exitOn = exitOn;
  }

  exit(signal: NodeJS.Signals | null = null): void {
    this.exitCode = signal ? null : 0;
    this.signalCode = signal;
    this.emit("exit", this.exitCode, signal);
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    if (
      (this.exitOn === "terminate" && signal === "SIGTERM") ||
      (this.exitOn === "kill" && signal === "SIGKILL")
    ) {
      this.exit(signal as NodeJS.Signals);
    }
    return true;
  }
}

const deadlines = { graceful: 20, terminate: 20, kill: 20 };

test("Electron fixture shutdown exits gracefully when the app cooperates", async () => {
  const process = new FakeProcess("close");

  const outcome = await shutdownFixtureProcess(
    process,
    async () => process.exit(),
    deadlines,
  );

  assert.equal(outcome, "graceful");
  assert.deepEqual(process.signals, []);
});

test("Electron fixture shutdown terminates an app that ignores close", async () => {
  const process = new FakeProcess("terminate");

  const outcome = await shutdownFixtureProcess(
    process,
    () => new Promise<void>(() => undefined),
    deadlines,
  );

  assert.equal(outcome, "terminated");
  assert.deepEqual(process.signals, ["SIGTERM"]);
});

test("Electron fixture shutdown kills an app that ignores termination", async () => {
  const process = new FakeProcess("kill");

  const outcome = await shutdownFixtureProcess(
    process,
    () => new Promise<void>(() => undefined),
    deadlines,
  );

  assert.equal(outcome, "killed");
  assert.deepEqual(process.signals, ["SIGTERM", "SIGKILL"]);
});
