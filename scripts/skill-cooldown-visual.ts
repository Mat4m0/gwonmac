/**
 * Deterministic, headless visual matrix for the shared cooldown view.
 * This is not a live-game acceptance test; pass a native crop as --reference
 * to compare the real background at 1x, 1.5x, and 2x.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "test-results", "skill-cooldown-visual");
const referencePath = process.argv.find((value) => value.startsWith("--reference="))?.slice(12);
const fontPath = process.argv.find((value) => value.startsWith("--font="))?.slice(7)
  ?? path.join(root, "src", "renderer", "fonts", "QTFrizQuad.otf");
const reference = referencePath ? (await readFile(referencePath)).toString("base64") : null;
const font = (await readFile(fontPath)).toString("base64");
await mkdir(outputDir, { recursive: true });

const compile = async (relative: string) => ts.transpileModule(
  await readFile(path.join(root, "src", relative), "utf8"),
  {
    fileName: relative,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  },
).outputText;
const moduleUrl = (source: string) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const appearanceUrl = moduleUrl(await compile("renderer/appearance.ts"));
const cooldownModelUrl = moduleUrl(await compile("shared/skill-cooldowns.ts"));
const bindingModelUrl = moduleUrl(await compile("shared/skill-key-bindings.ts"));
const cooldownView = (await compile("renderer/skill-cooldown-view.ts"))
  .replace("../shared/skill-cooldowns.js", cooldownModelUrl)
  .replace("./appearance.js", appearanceUrl);
const bindingView = (await compile("renderer/skill-key-binding-view.ts"))
  .replace("../shared/skill-key-bindings.js", bindingModelUrl)
  .replace("./appearance.js", appearanceUrl);

const browser = await chromium.launch();
try {
  for (const scale of [1, 1.5, 2]) {
    const page = await browser.newPage({
      viewport: { width: 1040, height: 920 },
      deviceScaleFactor: scale,
    });
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: "Guild Wars Original Display"; src: url("data:font/ttf;base64,${font}"); }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; background: #17332f; color: #f3ead6; font: 13px/1.3 system-ui; }
      body { padding: 24px; }
      h1 { margin: 0 0 18px; font-size: 18px; }
      .matrix { display: grid; grid-template-columns: 86px repeat(7, 96px); gap: 12px; align-items: center; }
      .row-label { color: #d2c5a5; }
      .fixture { display: grid; justify-items: center; gap: 4px; }
      .slot { position: relative; width: 82px; height: 82px; overflow: hidden; border: 2px solid #aeb1a8; border-radius: 7px;
        background: ${reference === null
          ? "radial-gradient(circle at 54% 43%, #e15acb 0 6%, #654395 31%, #14243a 72%)"
          : `center / cover no-repeat url("data:image/png;base64,${reference}")`};
        box-shadow: inset 0 0 14px rgb(0 0 0 / 64%), 0 1px 2px #000; }
      .fixture small { color: #b8b3a5; font-variant-numeric: tabular-nums; }
      .slot.small { width: 40px; height: 40px; }
      .slot.large { width: 140px; height: 140px; }
      .settings-skill-cooldown-preview-key { --skill-key-edge: 23px; position: absolute; right: 2px; bottom: 2px; max-width: calc(100% - 4px); }
      #sizes { display: flex; align-items: end; gap: 18px; margin-top: 26px; }
    </style></head><body><h1>Skill cooldown visual matrix · ${scale}×</h1><div id="matrix" class="matrix"></div><div id="sizes"></div></body></html>`);
    const referenceOutput = path.join(outputDir, `skill-cooldowns-${scale}x-reference.png`);
    await page.screenshot({ path: referenceOutput });
    await page.addScriptTag({
      type: "module",
      content: `${cooldownView}\nglobalThis.__cooldownView = createSkillCooldownView;`,
    });
    await page.addScriptTag({
      type: "module",
      content: `${bindingView}\nglobalThis.__bindingView = createSkillKeyBindingView;`,
    });
    const measurements = await page.evaluate(() => {
      const createCooldown = (globalThis as unknown as {
        __cooldownView(parent: HTMLElement): { element: HTMLElement; update(ms: number, color: unknown): void };
      }).__cooldownView;
      const createBinding = (globalThis as unknown as {
        __bindingView(parent: HTMLElement): { element: HTMLElement; update(binding: unknown): void };
      }).__bindingView;
      const matrix = document.getElementById("matrix")!;
      const values = [32_000, 14_000, 9_000, 3_000, 2_900, 400, 0];
      const colors = [
        ["Red", { kind: "preset", preset: "red" }],
        ["Cream", { kind: "preset", preset: "cream" }],
        ["Gold", { kind: "preset", preset: "gold" }],
        ["Blue", { kind: "preset", preset: "blue" }],
        ["Custom", { kind: "custom", value: "#c884ff" }],
      ] as const;
      const measured: Array<Record<string, number | string | null>> = [];
      for (const [name, color] of colors) {
        const label = document.createElement("span");
        label.className = "row-label";
        label.textContent = name;
        matrix.append(label);
        values.forEach((remainingMs, index) => {
          const fixture = document.createElement("span");
          fixture.className = "fixture";
          const slot = document.createElement("span");
          slot.className = "slot";
          const caption = document.createElement("small");
          caption.textContent = remainingMs === 0 ? "ready" : `${remainingMs} ms`;
          fixture.append(slot, caption);
          matrix.append(fixture);
          const view = createCooldown(slot);
          view.element.style.setProperty("--skill-cooldown-slot-height", "82px");
          view.update(remainingMs, color);
          if (name === "Red" && index === 4) {
            const key = createBinding(slot);
            key.element.classList.add("settings-skill-cooldown-preview-key");
            key.update({
              input: { kind: "keyboard", code: "F12" },
              modifiers: { control: true, option: true, shift: true, command: true },
            });
          }
          const rect = view.element.getBoundingClientRect();
          const glyph = view.element.firstElementChild?.getBoundingClientRect();
          measured.push({
            name,
            remainingMs,
            slot: rect.height,
            glyphWidth: glyph?.width ?? null,
            glyphHeight: glyph?.height ?? null,
          });
        });
      }
      const sizes = document.getElementById("sizes")!;
      for (const [className, edge] of [["small", 40], ["large", 140]] as const) {
        const slot = document.createElement("span");
        slot.className = `slot ${className}`;
        sizes.append(slot);
        const view = createCooldown(slot);
        view.element.style.setProperty("--skill-cooldown-slot-height", `${edge}px`);
        view.update(2_900, { kind: "preset", preset: "red" });
      }
      return measured;
    });
    await page.evaluate(() => document.fonts.ready);
    const renderedOutput = path.join(outputDir, `skill-cooldowns-${scale}x-rendered.png`);
    const rendered = await page.screenshot({ path: renderedOutput });
    const referencePng = await readFile(referenceOutput);
    const differenceDataUrl = await page.evaluate(async ({ before, after }) => {
      const load = (data: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `data:image/png;base64,${data}`;
      });
      const [left, right] = await Promise.all([load(before), load(after)]);
      const canvas = document.createElement("canvas");
      canvas.width = right.naturalWidth;
      canvas.height = right.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(left, 0, 0);
      const a = context.getImageData(0, 0, canvas.width, canvas.height);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(right, 0, 0);
      const b = context.getImageData(0, 0, canvas.width, canvas.height);
      const out = context.createImageData(canvas.width, canvas.height);
      for (let at = 0; at < out.data.length; at += 4) {
        out.data[at] = Math.abs(a.data[at]! - b.data[at]!);
        out.data[at + 1] = Math.abs(a.data[at + 1]! - b.data[at + 1]!);
        out.data[at + 2] = Math.abs(a.data[at + 2]! - b.data[at + 2]!);
        out.data[at + 3] = 255;
      }
      context.putImageData(out, 0, 0);
      return canvas.toDataURL("image/png");
    }, {
      before: referencePng.toString("base64"),
      after: rendered.toString("base64"),
    });
    const differenceOutput = path.join(outputDir, `skill-cooldowns-${scale}x-difference.png`);
    await writeFile(differenceOutput, Buffer.from(differenceDataUrl.split(",")[1]!, "base64"));
    console.log(JSON.stringify({
      scale,
      reference: referenceOutput,
      rendered: renderedOutput,
      difference: differenceOutput,
      measurements,
    }));
    await page.close();
  }
} finally {
  await browser.close();
}
