import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const args = process.argv.slice(2);
const fixture = args.find((value) => ["map", "target", "skill-keys"].includes(value))
  ?? "target";
const localFontPath = args.find((value) => value.startsWith("--font="))?.slice(7);
if (!["map", "target", "skill-keys"].includes(fixture)) {
  console.error(`unknown Enhancement visual fixture: ${fixture}`);
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "test-results", "enhancements-visual");
const output = path.join(outputDir, `${fixture}.png`);
const fixtureUrl = new URL(
  `?fixture=${fixture}`,
  pathToFileURL(path.join(root, "scripts", "enhancements-visual", "index.html")),
);

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: fixture === "skill-keys"
      ? { width: 1100, height: 520 }
      : { width: 720, height: 480 },
    deviceScaleFactor: 2,
  });
  if (fixture === "skill-keys") {
    const exactFont = Boolean(localFontPath);
    const font = (await readFile(
      localFontPath
        ?? path.join(root, "src", "renderer", "fonts", "QTFrizQuad.otf"),
    )).toString("base64");
    const fontFamily = exactFont ? "Guild Wars Original Display" : "QTFrizQuad";
    const fontFormat = exactFont ? "truetype" : "opentype";
    await page.setContent(`<!doctype html>
      <html><head><style>
        @font-face { font-family: "${fontFamily}"; src: url("data:font/ttf;base64,${font}") format("${fontFormat}"); }
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
        body { background: radial-gradient(circle at 50% 20%, #5b877e, #213d36 62%, #172a26); }
        #bars { position: absolute; left: 126px; top: 157px; width: 848px; height: 28px; display: flex; gap: 12px; }
        #bars span { flex: 1; border: 2px solid #c4c3b9; border-radius: 12px; background: linear-gradient(#248bc5, #145b88); box-shadow: inset 0 0 0 2px #172027, 0 2px 3px #0009; }
        .skillbar { position: absolute; left: 126px; display: flex; padding: 8px; border: 3px solid #d4d3c7; background: #514f46; box-shadow: inset 0 0 0 2px #282821, 0 3px 5px #0009; }
        #skillbar { top: 190px; }
        #skillbar-secondary { top: 332px; }
        .skill { width: 104px; height: 104px; border: 2px solid #a8a99f; background: radial-gradient(circle at 55% 45%, #65dbe1 0 8%, #267d9a 30%, #182f48 72%); box-shadow: inset 0 0 14px #8ef7ff7a; }
        .skill:nth-child(2n) { background: radial-gradient(circle at 55% 42%, #d55fdc 0 7%, #654294 34%, #17233e 72%); }
        #skillbar-secondary .skill { width: 140px; height: 140px; }
      </style></head><body>
        <div id="bars"><span></span><span></span></div>
        <div id="skillbar" class="skillbar">${"<div class=\"skill\"></div>".repeat(8)}</div>
        <div id="skillbar-secondary" class="skillbar"><div class="skill"></div><div class="skill"></div></div>
      </body></html>`);
    const compile = async (relative: string) => ts.transpileModule(
      await readFile(path.join(root, "src", relative), "utf8"),
      {
        fileName: relative,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    ).outputText;
    const moduleUrl = (source: string) =>
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    const bindingsUrl = moduleUrl(await compile("shared/skill-key-bindings.ts"));
    const appearanceUrl = moduleUrl(await compile("renderer/appearance.ts"));
    const bindingViewUrl = moduleUrl((await compile("renderer/skill-key-binding-view.ts"))
      .replace("../shared/skill-key-bindings.js", bindingsUrl)
      .replace("./appearance.js", appearanceUrl));
    const compiled = (await compile("renderer/skill-key-overlay.ts"))
      .replace("../shared/skill-key-bindings.js", bindingsUrl)
      .replace("./skill-key-binding-view.js", bindingViewUrl);
    await page.addScriptTag({
      type: "module",
      content: `${compiled}\nglobalThis.__createSkillKeyOverlay = createSkillKeyOverlay;`,
    });
    await page.waitForFunction(() =>
      typeof (globalThis as { __createSkillKeyOverlay?: unknown })
        .__createSkillKeyOverlay === "function"
    );
    await page.evaluate(() => {
      const create = (globalThis as unknown as {
        __createSkillKeyOverlay: (parent: HTMLElement) => {
          update(state: unknown): void;
        };
      }).__createSkillKeyOverlay;
      const overlay = create(document.body);
      const secondaryOverlay = create(document.body);
      const modifiers = (
        control = false,
        option = false,
        shift = false,
        command = false,
      ) => ({ control, option, shift, command });
      const bindings = [
        { input: { kind: "keyboard", code: "KeyC" }, modifiers: modifiers() },
        { input: { kind: "keyboard", code: "KeyC" }, modifiers: modifiers(false, false, true) },
        { input: { kind: "keyboard", code: "F12" }, modifiers: modifiers(true, true, true, true) },
        { input: { kind: "mouse-button", button: 0 }, modifiers: modifiers() },
        { input: { kind: "mouse-button", button: 2 }, modifiers: modifiers() },
        { input: { kind: "mouse-button", button: 1 }, modifiers: modifiers() },
        { input: { kind: "mouse-button", button: 4 }, modifiers: modifiers() },
        { input: { kind: "wheel", direction: "up" }, modifiers: modifiers() },
        { input: { kind: "wheel", direction: "down" }, modifiers: modifiers() },
        { input: { kind: "keyboard", code: "Digit7" }, modifiers: modifiers() },
      ];
      overlay.update({
        status: "ready",
        slots: bindings.slice(0, 8).map((binding, index) => ({
          x: 134 + index * 104,
          y: 198,
          width: 104,
          height: 104,
          binding,
        })),
      });
      secondaryOverlay.update({
        status: "ready",
        slots: [
          { x: 134, y: 340, width: 140, height: 140, binding: bindings[8] },
          { x: 274, y: 340, width: 140, height: 140, binding: bindings[9] },
        ],
      });
      document.body.dataset.ready = "true";
    });
  } else {
    await page.goto(fixtureUrl.href);
  }
  await page.locator("body[data-ready='true']").waitFor();
  await (fixture === "skill-keys"
    ? page.locator("body")
    : page.locator("#enhancement"))
    .screenshot({ path: output });
  console.log(JSON.stringify({ fixture, screenshot: output }));
} finally {
  await browser.close();
}
