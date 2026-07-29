import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import path from "node:path";
import {
  developmentElectronExecutable,
  packagedElectronLayout,
  terminateTestChild,
} from "../../scripts/electron-layout.js";

const root = path.resolve("repository");

describe("portable Electron layout", () => {
  it("resolves the development executable for each supported OS", () => {
    assert.equal(
      developmentElectronExecutable(root, "darwin"),
      path.join(
        root,
        "node_modules",
        "electron",
        "dist",
        "Electron.app",
        "Contents",
        "MacOS",
        "Electron",
      ),
    );
    assert.equal(
      developmentElectronExecutable(root, "win32"),
      path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    );
    assert.equal(
      developmentElectronExecutable(root, "linux"),
      path.join(root, "node_modules", "electron", "dist", "electron"),
    );
  });

  it("keeps executable, resources, and ASAR in one packaged model", () => {
    const mac = packagedElectronLayout(root, "darwin", "arm64");
    assert.equal(
      mac.executable,
      path.join(
        root,
        "out",
        "Guild Wars-darwin-arm64",
        "Guild Wars.app",
        "Contents",
        "MacOS",
        "Guild Wars",
      ),
    );
    assert.equal(mac.asar, path.join(mac.resources, "app.asar"));

    const windows = packagedElectronLayout(root, "win32", "x64");
    assert.equal(
      windows.executable,
      path.join(root, "out", "Guild Wars-win32-x64", "Guild Wars.exe"),
    );
    assert.equal(windows.asar, path.join(windows.resources, "app.asar"));

    const linux = packagedElectronLayout(root, "linux", "x64");
    assert.equal(
      linux.executable,
      path.join(root, "out", "Guild Wars-linux-x64", "Guild Wars"),
    );
    assert.equal(linux.asar, path.join(linux.resources, "app.asar"));
  });

  it("waits for a test child to be gone without asserting a signal", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    await terminateTestChild(child);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  });
});
