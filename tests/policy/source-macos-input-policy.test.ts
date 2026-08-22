import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const policyRoots = [
  "src",
  "docs/process-model.md",
  "docs/user-guide.md",
] as const;

async function sourceFiles(entry: string): Promise<string[]> {
  const children = await readdir(entry, { withFileTypes: true }).catch(() => null);
  if (!children) return [entry];
  return (
    await Promise.all(
      children.map((child) => sourceFiles(path.join(entry, child.name))),
    )
  ).flat();
}

describe("the macOS input policy", () => {
  it("has no selectable or persisted touch mode", async () => {
    const files = (await Promise.all(policyRoots.map(sourceFiles))).flat();
    const sources = await Promise.all(
      files.map(async (file) => [file, await readFile(file, "utf8")] as const),
    );
    for (const [file, source] of sources) {
      assert.doesNotMatch(
        source,
        /touchMode|Mobile touch compatibility|Mouse and touch together|Translate mouse to touch/,
        file,
      );
    }
  });

  it("sets the bundle-specific repeat preference before the first window", async () => {
    const main = await readFile("src/main/main.ts", "utf8");
    assert.match(
      main,
      /systemPreferences\.setUserDefault\(\s*"ApplePressAndHoldEnabled",\s*"boolean",\s*false/u,
    );
    const ready = main.indexOf("app.whenReady().then");
    const repeatPolicy = main.indexOf("systemPreferences.setUserDefault");
    const firstWindow = main.indexOf("createAccountsWindow(", repeatPolicy);
    assert.ok(ready >= 0 && repeatPolicy > ready);
    assert.ok(firstWindow > repeatPolicy);
  });
});
