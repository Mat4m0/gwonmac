/**
 * Replays the production native HUD atlas and ordered quads into an offline matrix.
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
// The fixture supplies the extracted font locally; it has no gw:// app host.
const appearanceUrl = moduleUrl(`export async function ensureGuildWarsFont() {
  await document.fonts.load('48px "Guild Wars Original Display"');
}`);
const cooldownModelUrl = moduleUrl(await compile("shared/skill-cooldowns.ts"));
const bindingModelUrl = moduleUrl(await compile("shared/skill-key-bindings.ts"));
const artworkUrl = moduleUrl((await compile("renderer/skill-key-artwork.ts"))
  .replace("../shared/skill-key-bindings.js", bindingModelUrl));
const hudContractUrl = moduleUrl(await compile("shared/native-hud.ts"));
const hudUrl = moduleUrl((await compile("renderer/native-hud-layer.ts"))
  .replace("../shared/native-hud.js", hudContractUrl)
  .replace("../shared/skill-key-bindings.js", bindingModelUrl)
  .replace("./skill-key-artwork.js", artworkUrl)
  .replace("./appearance.js", appearanceUrl));

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
      .native-hud-preview { position: absolute; inset: 0; width: 100%; height: 100%; }
      body[data-reference] .native-hud-preview { visibility: hidden; }
      #sizes { display: flex; align-items: end; gap: 18px; margin-top: 26px; }
    </style></head><body><h1>Skill cooldown visual matrix · ${scale}×</h1><div id="matrix" class="matrix"></div><div id="sizes"></div></body></html>`);
    await page.addScriptTag({type: "module", content: `
      import {createNativeHudLayer} from "${hudUrl}";
      import {formatSkillCooldown, skillCooldownCssColor} from "${cooldownModelUrl}";
      import {NATIVE_HUD_HEADER, NATIVE_HUD_ATLAS_SIZE} from "${hudContractUrl}";
      globalThis.__nativeHudFixture = {createNativeHudLayer, formatSkillCooldown, skillCooldownCssColor,
        header: NATIVE_HUD_HEADER, size: NATIVE_HUD_ATLAS_SIZE};
    `});
    const measurements = await page.evaluate(async (scale) => {
      const {createNativeHudLayer, formatSkillCooldown, skillCooldownCssColor, header, size} =
        (globalThis as unknown as {__nativeHudFixture: {
          createNativeHudLayer: typeof import("../src/renderer/native-hud-layer.js").createNativeHudLayer;
          formatSkillCooldown: typeof import("../src/shared/skill-cooldowns.js").formatSkillCooldown;
          skillCooldownCssColor: typeof import("../src/shared/skill-cooldowns.js").skillCooldownCssColor;
          header: number; size: number;
        }}).__nativeHudFixture;
      await document.fonts.load('48px "Guild Wars Original Display"');
      const memory = new WebAssembly.Memory({initial: 80});
      const atlas = document.createElement("canvas"); atlas.width = size; atlas.height = size;
      const atlasContext = atlas.getContext("2d")!;
      let quads: number[][] = [];
      const layer = createNativeHudLayer({memory, malloc: () => 1024, free() {},
        gwonmac_hud_reset() { quads = []; },
        gwonmac_hud_atlas(region: number) {
          const bytes = new Uint8Array(memory.buffer, region + 8, size * size * 4);
          const rgba = new Uint8ClampedArray(bytes.length);
          for (let n = 0; n < bytes.length; n += 4) {
            rgba[n] = bytes[n + 2]!; rgba[n + 1] = bytes[n + 1]!;
            rgba[n + 2] = bytes[n]!; rgba[n + 3] = bytes[n + 3]!;
          }
          atlasContext.putImageData(new ImageData(rgba, size, size), 0, 0); return 1;
        },
        gwonmac_hud_label(region: number) {
          const view = new DataView(memory.buffer, region);
          if (view.getUint32(8, true) !== 0) throw new Error("Unexpected native fixture slot");
          quads = Array.from({length: view.getUint32(20, true)}, (_, n) =>
            Array.from({length: 8}, (_, field) => view.getFloat32(header + n * 32 + field * 4, true)));
          return 1;
        },
      }, document);
      await Promise.resolve(); await Promise.resolve();
      const paint = (slot: HTMLElement, remainingMs: number,
        color: Parameters<typeof skillCooldownCssColor>[0], chord = false) => {
        const width = slot.clientWidth, height = slot.clientHeight;
        const item = {parent: 1, child: 0, width, height};
        layer.update("keys", [{...item, binding: {input: {kind: "keyboard", code: chord ? "F12" : "Digit7"},
          modifiers: {control: chord, option: chord, shift: chord, command: chord}}}]);
        const text = formatSkillCooldown(remainingMs);
        layer.update("cooldowns", [text === null ? null : {...item, text, color: skillCooldownCssColor(color)}]);
        const canvas = document.createElement("canvas"); canvas.className = "native-hud-preview";
        canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
        const context = canvas.getContext("2d")!;
        // Replay the production mesh order: the keycap is first, then glyphs.
        // This verifies atlas pixels and geometry, not the game's GPU ordering.
        for (const q of quads) {
          const [x, y, w, h, u, v, right, bottom] = q as [number, number, number, number, number, number, number, number];
          if (w > 0 && h > 0) context.drawImage(atlas, u * size, v * size, (right - u) * size, (bottom - v) * size,
            x * canvas.width, y * canvas.height, w * canvas.width, h * canvas.height);
        }
        slot.append(canvas);
        return {slot: height, quadCount: quads.length, label: text, keycap: chord ? "⌃⌥⇧⌘F12" : "7"};
      };
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
          measured.push({name, remainingMs, ...paint(slot, remainingMs, color, name === "Red" && index === 4)});
        });
      }
      const sizes = document.getElementById("sizes")!;
      for (const [className, edge] of [["small", 40], ["large", 140]] as const) {
        const slot = document.createElement("span");
        slot.className = `slot ${className}`;
        sizes.append(slot);
        measured.push({name: className, remainingMs: 2900, edge, ...paint(slot, 2900, {kind: "preset", preset: "red"})});
      }
      layer.dispose();
      return measured;
    }, scale);
    await page.evaluate(() => document.fonts.ready);
    const referenceOutput = path.join(outputDir, `skill-cooldowns-${scale}x-reference.png`);
    await page.evaluate(() => { document.body.dataset.reference = "true"; });
    await page.screenshot({path: referenceOutput});
    await page.evaluate(() => { delete document.body.dataset.reference; });
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
