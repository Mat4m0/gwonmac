// The Build Templates pane, driven end to end against a real main process.
//
// The default cached-only fixture has no client, so there is no real mount:
// the pane's own "the game has to be running" state is therefore free to test,
// and everything else installs a fake FS on the page the way the update spec
// fakes Module.FS. The export half is real all the way to disk — that is the
// part where a path crosses into the main process and gets written.

import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeOffline,
  isDomActiveElement,
  launchOffline,
} from "./fixtures.mjs";

const SKILLS = "OQCiUyo8AkVwR4KMMGAAAEAA";
const PASTED = "OACjIyhM5MXzyJlzbyMlmTuhJ";
const EQUIPMENT = "Pk5hbug2fkaiklWVqQhyI90YjyIBLziyIBTpgyIBr7hyIbB";

declare global {
  // The in-page stand-in for the mount, and the writes it received. It exists
  // only while this spec runs.
  var __templateFiles: Record<string, string>;
}

/**
 * A minimal Emscripten FS over a flat map, installed on the page. The pane
 * reaches `globalThis.FS`, so this is the whole of what it can see.
 */
async function installFakeMount(
  page: Awaited<ReturnType<typeof launchOffline>>["page"],
  files: Record<string, string>,
) {
  await page.evaluate((seed) => {
    globalThis.__templateFiles = { ...seed };
    const directories = new Set<string>([
      "/app:/Templates/Skills",
      "/app:/Templates/Equipment",
    ]);
    for (const file of Object.keys(globalThis.__templateFiles)) {
      const parts = file.split("/");
      for (let index = 2; index < parts.length; index += 1) {
        directories.add(parts.slice(0, index).join("/"));
      }
    }
    const fs = {
      readdir(target: string) {
        const prefix = `${target}/`;
        const names = new Set<string>();
        for (const known of [
          ...Object.keys(globalThis.__templateFiles),
          ...directories,
        ]) {
          if (known.startsWith(prefix)) {
            names.add(known.slice(prefix.length).split("/")[0] ?? "");
          }
        }
        return [".", "..", ...names];
      },
      stat: (target: string) => ({ mode: directories.has(target) ? 1 : 2 }),
      isDir: (mode: number) => mode === 1,
      isFile: (mode: number) => mode === 2,
      readFile(target: string) {
        const contents = globalThis.__templateFiles[target];
        if (contents === undefined) throw new Error(`missing ${target}`);
        return contents;
      },
      writeFile(target: string, data: string) {
        globalThis.__templateFiles[target] = data;
      },
      unlink(target: string) {
        delete globalThis.__templateFiles[target];
      },
      rmdir(target: string) {
        const prefix = `${target}/`;
        const occupied = [
          ...Object.keys(globalThis.__templateFiles),
          ...directories,
        ].some((known) => known.startsWith(prefix));
        if (occupied) throw new Error(`not empty: ${target}`);
        directories.delete(target);
      },
      mkdirTree(target: string) {
        const parts = target.split("/");
        for (let index = 2; index <= parts.length; index += 1) {
          directories.add(parts.slice(0, index).join("/"));
        }
      },
      analyzePath: (target: string) => ({
        exists:
          target in globalThis.__templateFiles || directories.has(target),
      }),
      syncfs: (_populate: boolean, callback: () => void) => callback(),
    };
    Object.assign(globalThis, { FS: fs });
  }, files);
}

const openTemplates = async (
  page: Awaited<ReturnType<typeof launchOffline>>["page"],
) => {
  await page.evaluate(() => {
    globalThis.dispatchEvent(
      new globalThis.CustomEvent("gw:settings", { detail: { pane: "templates" } }),
    );
  });
  await expect(page.locator("#settings-pane-templates")).toBeVisible();
};

test.describe("build templates", () => {
  test("tells the player to sign in and refreshes after startup", async () => {
    const fixture = await launchOffline("gw-templates-nomount-e2e-");
    try {
      await openTemplates(fixture.page);
      await expect(fixture.page.locator("#templates-status")).toContainText(
        "sign in, then reopen Templates",
      );
      await expect(fixture.page.locator("#templates-actions")).toBeHidden();

      await installFakeMount(fixture.page, {});
      await fixture.page.locator("#settings-tab-display").click();
      await fixture.page.locator("#settings-tab-templates").click();
      await expect(fixture.page.locator("#templates-status")).toHaveText(
        "No templates saved yet.",
      );
      await expect(fixture.page.locator("#templates-actions")).toBeVisible();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("previews an import, and writes nothing until it is confirmed", async () => {
    const fixture = await launchOffline("gw-templates-import-e2e-");
    try {
      const { page } = fixture;
      await installFakeMount(page, {
        "/app:/Templates/Skills/Shockaxe.txt": SKILLS,
      });
      await openTemplates(page);

      const list = {
        name: "MyBuilds.txt",
        mimeType: "text/plain",
        buffer: Buffer.from([
          `Me/E Domination\t${SKILLS}`,
          `[PvP Set;${EQUIPMENT}]`,
          // Already saved under this exact code: nothing to do.
          `Shockaxe: ${SKILLS}`,
          "a line with no code at all",
        ].join("\n")),
      };

      await page.setInputFiles("#templates-file-files", list);
      await expect(page.locator("#templates-preview")).toBeVisible();
      // The preview is the task: the source buttons stand down so the pane
      // still fits, and Cancel is the way back to them.
      await expect(page.locator("#templates-actions")).toBeHidden();
      await expect(page.locator("#templates-preview-summary")).toHaveText(
        "1 skill template and 1 equipment template will be imported.",
      );
      await expect(page.locator("#templates-preview-skipped")).toContainText(
        "1 already saved",
      );
      await expect(page.locator("#templates-preview-skipped")).toContainText(
        "1 line with no template code",
      );

      // Still nothing written: the preview is the confirmation.
      expect(
        await page.evaluate(() => Object.keys(globalThis.__templateFiles).length),
      ).toBe(1);

      // Cancel restores the pane, then the same source is picked again.
      await page.locator("#templates-cancel").click();
      await expect(page.locator("#templates-preview")).toBeHidden();
      await expect(page.locator("#templates-actions")).toBeVisible();
      await page.setInputFiles("#templates-file-files", list);

      await page.locator("#templates-confirm").click();
      await expect(page.locator("#templates-status")).toContainText(
        "Imported 2 templates.",
      );
      await expect(page.locator("#templates-actions")).toBeVisible();
      // The client caches its template scan, so the sentence has to say this.
      await expect(page.locator("#templates-status")).toContainText("Refresh List");

      expect(
        await page.evaluate(() => globalThis.__templateFiles),
      ).toMatchObject({
        "/app:/Templates/Skills/Shockaxe.txt": SKILLS,
        "/app:/Templates/Skills/Me-E Domination.txt": SKILLS,
        "/app:/Templates/Equipment/PvP Set.txt": EQUIPMENT,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("a pasted code can be named before it is saved", async () => {
    const fixture = await launchOffline("gw-templates-clipboard-e2e-");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ clipboard }, code) => {
        clipboard.readText = () => code;
      }, PASTED);

      await installFakeMount(page, {});
      await openTemplates(page);
      await page.locator("#templates-import-clipboard").click();

      // A bare code has no name of its own, so the field is offered.
      await expect(page.locator("#templates-name-field")).toBeVisible();
      await expect(page.locator("#templates-preview-summary")).toHaveText(
        "1 skill template will be imported.",
      );

      await page.locator("#templates-name").fill("Paragon Imbagon");
      await page.locator("#templates-confirm").click();

      await expect(page.locator("#templates-status")).toContainText("Imported 1");
      expect(
        await page.evaluate(() => Object.keys(globalThis.__templateFiles)),
      ).toEqual(["/app:/Templates/Skills/Paragon Imbagon.txt"]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("the name field takes the caret, and never carries over to another source", async () => {
    const fixture = await launchOffline("gw-templates-name-reset-e2e-");
    const source = await mkdtemp(path.join(tmpdir(), "gw-templates-reset-"));
    try {
      const { app, page } = fixture;
      await app.evaluate(({ clipboard }, code) => {
        clipboard.readText = () => code;
      }, PASTED);

      await installFakeMount(page, {});
      await openTemplates(page);
      await page.locator("#templates-import-clipboard").click();

      // The caret lands where the next act is, rather than making it be found.
      await expect.poll(
        () => isDomActiveElement(page.locator("#templates-name")),
      ).toBe(true);
      await page.locator("#templates-name").fill("Paragon Imbagon");

      // A different source has nothing to do with that name.
      const file = path.join(source, "Shockaxe.txt");
      await writeFile(file, SKILLS);
      await page.setInputFiles("#templates-file-files", [file]);

      await expect(page.locator("#templates-name-field")).toBeHidden();
      await expect(page.locator("#templates-name")).toHaveValue("");

      await page.locator("#templates-confirm").click();
      expect(
        await page.evaluate(() => Object.keys(globalThis.__templateFiles)),
      ).toEqual(["/app:/Templates/Skills/Shockaxe.txt"]);
    } finally {
      await closeOffline(fixture);
      await rm(source, { recursive: true, force: true });
    }
  });

  test("exports the layout the game writes, and replaces nothing", async () => {
    const fixture = await launchOffline("gw-templates-export-e2e-");
    const destination = await mkdtemp(path.join(tmpdir(), "gw-templates-out-"));
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }, chosen) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [chosen],
        });
      }, destination);

      await installFakeMount(page, {
        "/app:/Templates/Skills/Warrior/Shockaxe.txt": SKILLS,
        "/app:/Templates/Equipment/PvP Set.txt": EQUIPMENT,
      });
      await openTemplates(page);
      await page.locator("#templates-export").click();
      await expect(page.locator("#templates-status")).toHaveText(
        "Exported 2 templates.",
      );

      const root = path.join(destination, "Guild Wars Build Templates");
      const written = await readFile(
        path.join(root, "Skills/Warrior/Shockaxe.txt"),
        "utf8",
      );
      // Byte-identical to what the game writes: the code, no trailing newline.
      expect(written).toBe(SKILLS);
      expect(
        await readFile(path.join(root, "Equipment/PvP Set.txt"), "utf8"),
      ).toBe(EQUIPMENT);

      // A second export never writes into the first. The status already reads
      // "Exported 2…" from the first run, so the folder listing is the only
      // thing that can tell us the second one finished.
      await page.locator("#templates-export").click();
      await expect
        .poll(async () => (await readdir(destination)).sort())
        .toEqual([
          "Guild Wars Build Templates",
          "Guild Wars Build Templates 2",
        ]);
      const second = path.join(destination, "Guild Wars Build Templates 2");
      await expect.poll(async () => {
        try {
          return await Promise.all([
            readFile(path.join(second, "Skills/Warrior/Shockaxe.txt"), "utf8"),
            readFile(path.join(second, "Equipment/PvP Set.txt"), "utf8"),
          ]);
        } catch {
          return null;
        }
      }).toEqual([SKILLS, EQUIPMENT]);
    } finally {
      await closeOffline(fixture);
      await rm(destination, { recursive: true, force: true });
    }
  });

  test("cancelling the destination panel writes nothing and says nothing", async () => {
    const fixture = await launchOffline("gw-templates-export-cancel-e2e-");
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      });

      await installFakeMount(page, {
        "/app:/Templates/Skills/Shockaxe.txt": SKILLS,
      });
      await openTemplates(page);
      await page.locator("#templates-export").click();
      await expect(page.locator("#templates-status")).toHaveText(
        "1 skill template saved.",
      );
    } finally {
      await closeOffline(fixture);
    }
  });
});
