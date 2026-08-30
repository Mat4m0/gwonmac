/** Squirrel lifecycle switches never enter the product startup path. */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  handleWindowsSquirrelStartup,
  windowsSquirrelEvent,
  windowsSquirrelFirstRun,
  windowsSquirrelUpdateArguments,
} from "../../src/main/windows-squirrel-startup.ts";

describe("Squirrel.Windows startup", () => {
  it("recognizes one exact lifecycle switch and refuses conflicts", () => {
    assert.equal(windowsSquirrelEvent(["app.exe", "--squirrel-install"]), "--squirrel-install");
    assert.equal(windowsSquirrelEvent(["app.exe", "--squirrel-firstrun"]), null);
    assert.equal(windowsSquirrelFirstRun(["app.exe", "--squirrel-firstrun"]), true);
    assert.equal(windowsSquirrelFirstRun(["app.exe"]), false);
    assert.throws(() => windowsSquirrelEvent([
      "--squirrel-install",
      "--squirrel-uninstall",
    ]));
  });

  it("creates or removes only the installed executable shortcut", () => {
    assert.deepEqual(
      windowsSquirrelUpdateArguments("--squirrel-updated", "Guild Wars Reforged.exe"),
      ["--createShortcut", "Guild Wars Reforged.exe"],
    );
    assert.deepEqual(
      windowsSquirrelUpdateArguments("--squirrel-uninstall", "Guild Wars Reforged.exe"),
      ["--removeShortcut", "Guild Wars Reforged.exe"],
    );
    assert.equal(
      windowsSquirrelUpdateArguments("--squirrel-obsolete", "Guild Wars Reforged.exe"),
      null,
    );
  });

  it("runs Update.exe detached and quits before normal startup", () => {
    const calls: unknown[][] = [];
    const handled = handleWindowsSquirrelStartup({
      argv: ["app.exe", "--squirrel-install"],
      execPath: "C:\\Users\\Player\\AppData\\Local\\GuildWarsReforged\\app-1.0.0\\Guild Wars Reforged.exe",
      executableName: "Guild Wars Reforged.exe",
      quit: () => calls.push(["quit"]),
      spawnUpdate: (executable, args) => {
        calls.push(["spawn", executable, args]);
        return { unref: () => calls.push(["unref"]) };
      },
    });
    assert.equal(handled, true);
    assert.deepEqual(calls, [
      [
        "spawn",
        path.win32.resolve(
          "C:\\Users\\Player\\AppData\\Local\\GuildWarsReforged\\app-1.0.0",
          "..",
          "Update.exe",
        ),
        ["--createShortcut", "Guild Wars Reforged.exe"],
      ],
      ["unref"],
      ["quit"],
    ]);
  });
});
