import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleSquirrelStartup,
  squirrelLifecycleArgument,
  type SquirrelStartupEnvironment,
} from "../../src/main/squirrel-startup.ts";

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: Parameters<SquirrelStartupEnvironment["spawnProcess"]>[2];
}

function environment(
  argv: readonly string[],
  platform: NodeJS.Platform = "win32",
): {
  value: SquirrelStartupEnvironment;
  calls: SpawnCall[];
  unrefs: { count: number };
} {
  const calls: SpawnCall[] = [];
  const unrefs = { count: 0 };
  return {
    value: {
      platform,
      argv,
      execPath: "C:\\Users\\Player\\AppData\\Local\\GuildWars\\app-1.2.3\\Guild Wars.exe",
      spawnProcess: (command, args, options) => {
        calls.push({ command, args, options });
        return { unref: () => {
          unrefs.count += 1;
        } };
      },
    },
    calls,
    unrefs,
  };
}

test("Squirrel startup is ignored outside Windows and for ordinary launches", () => {
  assert.equal(
    handleSquirrelStartup(environment(["--squirrel-install"], "linux").value),
    false,
  );
  assert.equal(handleSquirrelStartup(environment([]).value), false);
  assert.equal(handleSquirrelStartup(environment(["--squirrel-firstrun"]).value), false);
});

for (const argument of ["--squirrel-install", "--squirrel-updated"] as const) {
  test(`${argument} creates the installed executable shortcut`, () => {
    const fixture = environment([argument]);
    assert.equal(handleSquirrelStartup(fixture.value), true);
    assert.deepEqual(fixture.calls, [{
      command: "C:\\Users\\Player\\AppData\\Local\\GuildWars\\Update.exe",
      args: ["--createShortcut", "Guild Wars.exe"],
      options: { detached: true, stdio: "ignore", windowsHide: true },
    }]);
    assert.equal(fixture.unrefs.count, 1);
  });
}

test("Squirrel uninstall removes the installed executable shortcut", () => {
  const fixture = environment(["--squirrel-uninstall"]);
  assert.equal(handleSquirrelStartup(fixture.value), true);
  assert.deepEqual(fixture.calls[0]?.args, ["--removeShortcut", "Guild Wars.exe"]);
  assert.equal(fixture.unrefs.count, 1);
});

test("Squirrel obsolete exits without running Update.exe", () => {
  const fixture = environment(["--squirrel-obsolete"]);
  assert.equal(handleSquirrelStartup(fixture.value), true);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.unrefs.count, 0);
});

test("contradictory Squirrel lifecycle arguments fail closed", () => {
  assert.throws(
    () => squirrelLifecycleArgument([
      "--squirrel-install",
      "--squirrel-uninstall",
    ]),
    /multiple Squirrel lifecycle arguments/u,
  );
});
