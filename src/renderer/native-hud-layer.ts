/**
 * Owns the shared detached HUD atlas. Countdown changes publish bounded glyph
 * quads; only font, badge, or color changes upload pixels to the native client.
 */
import { NATIVE_HUD_ATLAS_SIZE as SIZE, NATIVE_HUD_HEADER, NATIVE_HUD_MAGIC, NATIVE_HUD_QUADS, NATIVE_HUD_KEYCAP, NATIVE_HUD_SKILLS, NATIVE_HUD_LABELS,
  type NativeHudQuad } from "../shared/native-hud.js";
import { type SkillKeyBinding } from "../shared/skill-key-bindings.js";
import { paintSkillKeyPlate, skillKeyPlateLayout } from "./skill-key-artwork.js";
import { ensureGuildWarsFont } from "./appearance.js";

export type NativeHudItem = Readonly<{
  parent: number; child: number; width: number; height: number;
  text?: string; color?: string; binding?: SkillKeyBinding;
}>;
export type NativeHudChannel = "keys" | "cooldowns" | "effects";
export type NativeHudLayer = Readonly<{
  update(channel: NativeHudChannel, items: readonly (NativeHudItem | null)[]): void;
  dispose(): void;
}>;
type Sprite = Readonly<{ x: number; y: number; width: number; height: number; advance: number }>;
const FONT = '"Guild Wars Original Display", "Guild Wars Original", "QTFrizQuad", Palatino, Georgia, serif';
const CHANNELS = {cooldowns: {count: 8}, keys: {count: 8}, effects: {count: 64}} as const;


export function createNativeHudLayer(exports: WebAssembly.Exports, document: Document): NativeHudLayer {
  const memory = exports.memory, malloc = exports.malloc, free = exports.free;
  const upload = exports.gwonmac_hud_atlas, publish = exports.gwonmac_hud_label, reset = exports.gwonmac_hud_reset;
  const available = memory instanceof WebAssembly.Memory && typeof malloc === "function" && typeof free === "function"
    && typeof upload === "function" && typeof publish === "function" && typeof reset === "function";
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  const items = new Map<NativeHudChannel, readonly (NativeHudItem | null)[]>();
  const signatures = new Map<number, string>();
  const sprites = new Map<string, Sprite>();
  let atlasGeneration = 0, disposed = false, fontReady = false;
  let nextX = 2, nextY = 2, rowHeight = 0;
  const write = (bytes: number, operation: (region: number, view: DataView) => boolean) => {
    if (!available) return false;
    // wasm32 exposes allocations above 2 GiB as signed i32 values.
    const region = Number(malloc(bytes)) >>> 0;
    if (!region) return false;
    try { return operation(region, new DataView(memory.buffer, region, bytes)); } finally { free(region); }
  };
  const sprite = (key: string, width: number, height: number, paint: () => number) => {
    if (!ctx) return;
    if (nextX + width + 2 > SIZE) { nextX = 2; nextY += rowHeight + 2; rowHeight = 0; }
    if (nextY + height + 2 > SIZE) throw new Error("Native HUD atlas capacity exceeded");
    ctx.save(); ctx.translate(nextX, nextY); const advance = paint(); ctx.restore();
    sprites.set(key, {x: nextX, y: nextY, width, height, advance}); nextX += width + 2; rowHeight = Math.max(rowHeight, height);
  };
  const style = (channel: NativeHudChannel, item: NativeHudItem) => `${channel === "effects" ? "effect" : "cooldown"}:${item.color ?? "#eadcc2"}`;
  const rebuild = () => {
    if (!canvas) {
      canvas = document.createElement("canvas"); canvas.width = SIZE; canvas.height = SIZE;
      ctx = canvas.getContext("2d", {willReadFrequently: true});
    }
    const context = ctx;
    if (!context) return false;
    sprites.clear(); nextX = 2; nextY = 2; rowHeight = 0; context.clearRect(0, 0, SIZE, SIZE);
    const styles = new Map<string, {effect: boolean; color: string}>();
    for (const color of ["#eadcc2", "#e5ad52", "#c86c65"]) styles.set(`effect:${color}`, {effect: true, color});
    for (const [channel, entries] of items) for (const item of entries) {
      if (!item) continue;
      if (item.binding) {
        const key = `key:${JSON.stringify(item.binding)}`;
        if (!sprites.has(key)) sprite(key, 300, 68, () => paintSkillKeyPlate(context, item.binding!));
      } else styles.set(style(channel, item), {effect: channel === "effects", color: item.color ?? "#eadcc2"});
    }
    for (const [key, {effect, color}] of styles) {
      context.font = effect ? "700 48px system-ui, sans-serif" : `48px ${FONT}`;
      context.textBaseline = "alphabetic"; context.textAlign = "left";
      // The original font has proportional digits. Give every digit one fixed
      // cell and center its visible ink, so neither bearings nor a narrow 1
      // move the countdown when its value changes.
      const digitAdvance = Math.ceil(Math.max(...Array.from("0123456789", character => context.measureText(character).width)));
      for (const character of "0123456789.m") {
        sprite(`${key}:${character}`, 64, 80, () => {
          const metrics = context.measureText(character);
          const digit = character >= "0" && character <= "9";
          const advance = digit ? digitAdvance : metrics.width;
          const left = metrics.actualBoundingBoxLeft ?? 0;
          const right = metrics.actualBoundingBoxRight ?? metrics.width;
          const x = 8 + (advance - left - right) / 2 + left;
          const y = digit ? 40 + ((metrics.actualBoundingBoxAscent ?? 33) - (metrics.actualBoundingBoxDescent ?? 0)) / 2 : 57;
          context.lineJoin = "round"; context.lineWidth = effect ? 5 : 4.8;
          context.strokeStyle = "#120d0a"; context.fillStyle = color;
          context.shadowColor = "rgba(0,0,0,.88)"; context.shadowBlur = 2; context.shadowOffsetY = 2;
          context.strokeText(character, x, y); context.fillText(character, x, y);
          return advance;
        });
      }
    }
    const rgba = context.getImageData(0, 0, SIZE, SIZE).data;
    return write(8 + rgba.length, (region, view) => {
      view.setUint32(0, NATIVE_HUD_MAGIC, true); view.setUint32(4, SIZE, true);
      const bytes = new Uint8Array(view.buffer, region + 8, rgba.length);
      for (let at = 0; at < rgba.length; at += 4) { bytes[at] = rgba[at + 2]!; bytes[at + 1] = rgba[at + 1]!; bytes[at + 2] = rgba[at]!; bytes[at + 3] = rgba[at + 3]!; }
      return typeof upload === "function" && upload(region, 8 + rgba.length) === 1;
    });
  };
  const quad = (entry: Sprite, x: number, y: number, width: number, height: number, bottomLimit = 1): NativeHudQuad => {
    // Clip pixels and UVs together to keep all drawing inside the owning icon.
    const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(1, x + width), bottom = Math.min(bottomLimit, y + height);
    return {x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top),
      u: (entry.x + (left - x) / width * entry.width) / SIZE,
      v: (entry.y + (top - y) / height * entry.height) / SIZE,
      right: (entry.x + (right - x) / width * entry.width) / SIZE,
      bottom: (entry.y + (bottom - y) / height * entry.height) / SIZE};
  };
  const quads = (channel: NativeHudChannel, item: NativeHudItem): readonly NativeHudQuad[] => {
    if (![item.width, item.height].every((value) => Number.isFinite(value) && value > 0 && value <= 32768)) return [];
    if (item.binding) {
      const entry = sprites.get(`key:${JSON.stringify(item.binding)}`); if (!entry) return [];
      const layout = skillKeyPlateLayout(item.width, item.height, entry.advance);
      const cropped = {...entry, width: entry.advance, height: 64};
      const width = layout.width / item.width, height = layout.height / item.height;
      return [quad(cropped, 1 - layout.inset / item.width - width, 1 - layout.inset / item.height - height, width, height)];
    }
    const text = item.text ?? ""; if (!text || text.length > NATIVE_HUD_QUADS - (channel === "cooldowns" ? 1 : 0)) return [];
    const entries = Array.from(text, (char) => sprites.get(`${style(channel, item)}:${char}`));
    if (entries.some((entry) => !entry)) return [];
    const glyphs = entries.filter((entry): entry is Sprite => entry !== undefined);
    const effect = channel === "effects";
    const fontSize = effect ? Math.min(18, Math.max(11, item.height * .38))
      : item.height * (text.length >= 4 ? .40 : text.includes(".") ? .48 : .56);
    let scale = fontSize / 48;
    const advance = glyphs.reduce((sum, entry) => sum + entry.advance, 0);
    scale = Math.min(scale, item.width * (effect ? .84 : .82) / advance);
    let x = effect ? item.width * .92 - advance * scale : (item.width - advance * scale) / 2;
    // Effects reserve the lower strip for the native duration bar and border.
    // Keep the number inside the artwork, including its outline and shadow.
    const y = effect ? item.height * .80 - 60 * scale : item.height / 2 - 40 * scale;
    return glyphs.map((entry) => {
      const result = quad(entry, (x - 8 * scale) / item.width, y / item.height, entry.width * scale / item.width, entry.height * scale / item.height, effect ? .84 : 1);
      x += entry.advance * scale; return result;
    });
  };
  const render = () => {
    if (disposed || !available || !fontReady) return;
    // Allocate only on first use. Retain the bounded atlas through short gaps
    // so each new cooldown does not allocate and upload another texture.
    if (atlasGeneration === 0 && ![...items.values()].some(entries => entries.some(Boolean))) return;
    const missing = [...items].some(([channel, entries]) => entries.some((item) => item &&
      !sprites.has(item.binding ? `key:${JSON.stringify(item.binding)}` : `${style(channel, item)}:0`)));
    if (atlasGeneration === 0 || missing) {
      if (!rebuild()) { reset(); atlasGeneration = 0; signatures.clear(); return; }
      atlasGeneration++;
      // Repacking moves UVs. Invalidate live labels while keeping their old
      // signatures until withdrawn; clearing the map would lose removed slots.
    }
    // One native draw per icon makes the keycap/cooldown order inseparable.
    // Independent native draw objects can be reordered downstream of collection.
    for (let index = 0; index < NATIVE_HUD_LABELS; index++) {
      const skill = index < NATIVE_HUD_SKILLS;
      const key = skill ? items.get("keys")?.[index] : null;
      const timer = skill ? items.get("cooldowns")?.[index] : items.get("effects")?.[index - NATIVE_HUD_SKILLS];
      const item = key ?? timer;
      // Never combine observations from different native icon generations.
      const matchingTimer = timer && item && timer.parent === item.parent && timer.child === item.child ? timer : null;
      const signature = item ? JSON.stringify([atlasGeneration, key, matchingTimer]) : "";
      if ((signatures.get(index) ?? "") === signature) continue;
      const keyQuads = key ? quads("keys", key) : [];
      const timerQuads = matchingTimer && item ? quads(skill ? "cooldowns" : "effects",
        {...matchingTimer, width: item.width, height: item.height}) : [];
      const vertices = [...keyQuads, ...timerQuads];
      const flags = keyQuads.length ? NATIVE_HUD_KEYCAP : 0;
      const bytes = NATIVE_HUD_HEADER + vertices.length * 32;
      if (write(bytes, (region, view) => {
        [NATIVE_HUD_MAGIC, bytes, index, item?.parent ?? 0, item?.child ?? 0, vertices.length, flags].forEach((value, at) => view.setUint32(at * 4, value, true));
        vertices.forEach((q, at) => [q.x, q.y, q.width, q.height, q.u, q.v, q.right, q.bottom].forEach((v, field) => view.setFloat32(NATIVE_HUD_HEADER + at * 32 + field * 4, v, true)));
        return typeof publish === "function" && publish(region, bytes) === 1;
      })) signatures.set(index, signature);
    }

  };
  const resetContext = () => { if (typeof reset === "function") reset(); atlasGeneration = 0; signatures.clear(); render(); };
  const view = document.defaultView;
  view?.addEventListener("gw:graphics-context-reset", resetContext);
  const stats = () => ({available, ...Object.fromEntries(["uploads", "updates", "created", "destroyed", "collections", "matched", "published"].map((name) => {
    const value = exports[`gwonmac_hud_${name}`]; return [name, value instanceof WebAssembly.Global ? Number(value.value) : null];
  }))});
  if (view) view.gwNativeHudStats = stats;
  void ensureGuildWarsFont().then(() => { fontReady = true; render(); });
  return Object.freeze({
    update(channel, next) {
      if (disposed) return;
      const bounded = next.slice(0, CHANNELS[channel].count);
      if (channel === "effects") {
        // Expiring one effect must not move every remaining label to a new
        // native resource slot. Preserve slots by the native icon identity.
        const previous = items.get(channel) ?? [];
        const stable: (NativeHudItem | null)[] = Array.from({length: 64}, () => null);
        const additions: NativeHudItem[] = [];
        for (const item of bounded) {
          if (!item) continue;
          const index = previous.findIndex((old) => old?.parent === item.parent && old.child === item.child);
          if (index >= 0) stable[index] = item; else additions.push(item);
        }
        for (const item of additions) { const index = stable.indexOf(null); if (index >= 0) stable[index] = item; }
        items.set(channel, stable);
      } else items.set(channel, bounded);
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { if (typeof reset === "function") reset(); }
      finally {
        view?.removeEventListener("gw:graphics-context-reset", resetContext);
        if (view?.gwNativeHudStats === stats) delete view.gwNativeHudStats;
        items.clear(); sprites.clear(); signatures.clear();
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        canvas = null; ctx = null;
      }
    },
  });
}
