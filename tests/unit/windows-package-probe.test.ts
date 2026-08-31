/** The Windows package probe refuses marker, artifact, and feed drift. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createPackage, getRawHeader } from "@electron/asar";
import { probeWindowsPackage } from "../../scripts/windows-package-probe.ts";

describe("Windows package probe", () => {
  it("accepts one unsigned full package and refuses a capability marker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gwonmac-windows-package-"));
    const product = "Guild Wars Reforged";
    const resources = path.join(root, "out", `${product}-win32-x64`, "resources");
    const native = path.join(resources, "app.asar.unpacked", "build", "native");
    const appSource = path.join(root, "app-source");
    const make = path.join(root, "out", "make", "squirrel.windows", "x64");
    const setup = "Guild-Wars-Reforged-2026.8.10-Windows-x64-Setup.exe";
    const packageName = "GuildWarsReforged-2026.8.10-full.nupkg";
    try {
      await mkdir(native, { recursive: true });
      await mkdir(appSource, { recursive: true });
      await mkdir(make, { recursive: true });
      await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "2026.8.10" }));
      await writeFile(path.join(appSource, "main.js"), "export {};\n");
      const archive = path.join(resources, "app.asar");
      await createPackage(appSource, archive);
      const hash = createHash("sha256")
        .update(getRawHeader(archive).headerString)
        .digest("hex");
      const integrity = JSON.stringify([{
        file: "resources\\app.asar",
        alg: "SHA256",
        value: hash,
      }]);
      for (const file of [
        path.join(native, "windows-host.node"),
        path.join(native, "gw-dat-decode.exe"),
        path.join(make, setup),
      ]) await writeFile(file, "MZfixture");
      await writeFile(
        path.join(root, "out", `${product}-win32-x64`, `${product}.exe`),
        `MZfixture${integrity}`,
      );
      await writeFile(path.join(make, packageName), "package");
      await writeFile(path.join(make, "RELEASES"), `${"a".repeat(40)} ${packageName} 7\n`);
      assert.equal((await probeWindowsPackage(root)).setup, setup);
      await writeFile(path.join(appSource, "main.js"), "export const changed = true;\n");
      await createPackage(appSource, archive);
      await assert.rejects(() => probeWindowsPackage(root));
      await rm(archive);
      await writeFile(path.join(appSource, "main.js"), "export {};\n");
      await createPackage(appSource, archive);
      await writeFile(path.join(resources, "distribution-channel.json"), "{}");
      await assert.rejects(() => probeWindowsPackage(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
