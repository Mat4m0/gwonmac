/**
 * Owns keycap artwork shared by the native HUD and its visual calibration.
 * Extends the original game's bevel for player-authored modifier combinations.
 */
import { skillKeyPresentation, type SkillKeyBinding } from "../shared/skill-key-bindings.js";
const FONT = '"Guild Wars Original Display", "Guild Wars Original", "QTFrizQuad", Palatino, Georgia, serif';

/** Stock digit tiles are 24 units with seven transparent units above/left.
 * Match their 17-unit visible plate inside the 56-unit native skill icon. */
export function skillKeyPlateLayout(iconWidth: number, iconHeight: number, artworkWidth: number) {
  const unit = Math.min(iconWidth, iconHeight) / 56;
  const inset = unit;
  const scale = Math.min(17 * unit / 64, (iconWidth - 2 * inset) / artworkWidth);
  return {width: artworkWidth * scale, height: 64 * scale, inset};
}

/** Extend the stock keycap bevel across a complete keyboard or mouse binding. */
export function paintSkillKeyPlate(ctx: CanvasRenderingContext2D, binding: SkillKeyBinding): number {
  const presentation = skillKeyPresentation(binding);
  const edge = 64, compact = presentation.modifiers.length >= 3;
  const main = presentation.main;
  const fontSize = main.kind === "text" ? main.label.length > 2 ? 29 : main.label.length > 1 ? 37 : 49 : 49;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const measure = (label: string, font: string) => {
    ctx.font = font;
    const metrics = ctx.measureText(label);
    const left = metrics.actualBoundingBoxLeft ?? 0;
    const right = metrics.actualBoundingBoxRight ?? metrics.width;
    return {label, font, left, width: left + right,
      baseline: 34 + ((metrics.actualBoundingBoxAscent ?? 33) - (metrics.actualBoundingBoxDescent ?? 0)) / 2};
  };
  const modifiers = presentation.modifiers.map(label => measure(label, `600 ${compact ? 31 : 36}px system-ui, sans-serif`));
  const mainText = main.kind === "text" ? measure(main.label, `700 ${fontSize}px ${FONT}`) : null;
  const gap = 5, padding = 10;
  const modifierWidth = modifiers.reduce((sum, part) => sum + part.width + gap, 0);
  const mainWidth = mainText?.width ?? (main.kind === "wheel" ? 50 : 42);
  const contentWidth = modifierWidth + mainWidth;
  const width = Math.ceil(Math.max(62, padding * 2 + contentWidth));
  // Original numbered keycaps have a silver upper-left bevel and dark olive
  // face. Draw that shape at atlas resolution so arbitrary Mac chords fit.
  const gradient = ctx.createLinearGradient(0, 0, 0, edge);
  for (const [at, color] of [[0, "#c4c7bd"], [.12, "#92988a"], [.28, "#666f59"], [.55, "#464d36"], [.8, "#30351f"], [1, "#171b0f"]] as const) gradient.addColorStop(at, color);
  ctx.beginPath(); ctx.roundRect(1, 1, width - 2, edge - 2, [14, 2, 2, 2]);
  ctx.fillStyle = "#090b06"; ctx.fill();
  ctx.beginPath(); ctx.roundRect(3, 3, width - 7, edge - 7, [12, 1, 1, 1]);
  ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); ctx.moveTo(5, 26); ctx.lineTo(5, 15); ctx.quadraticCurveTo(5, 5, 16, 5); ctx.lineTo(width - 5, 5);
  ctx.lineWidth = 4; ctx.strokeStyle = "#d0d3c9"; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, 29); ctx.lineTo(9, 17); ctx.quadraticCurveTo(9, 10, 18, 10); ctx.lineTo(width - 9, 10);
  ctx.lineWidth = 3; ctx.strokeStyle = "#737b67"; ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,.48)"; ctx.fillRect(4, edge - 7, width - 8, 3); ctx.fillRect(width - 7, 9, 3, edge - 13);
  ctx.fillStyle = "#f4eed8";
  ctx.shadowColor = "#050504"; ctx.shadowBlur = 1; ctx.shadowOffsetY = 2;
  ctx.strokeStyle = "#080705"; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
  let x = (width - contentWidth) / 2;
  for (const part of modifiers) {
    ctx.font = part.font;
    ctx.strokeText(part.label, x + part.left, part.baseline); ctx.fillText(part.label, x + part.left, part.baseline);
    x += part.width + gap;
  }
  if (mainText) {
    ctx.font = mainText.font;
    ctx.strokeText(mainText.label, x + mainText.left, mainText.baseline); ctx.fillText(mainText.label, x + mainText.left, mainText.baseline);
  }
  else {
    ctx.save(); ctx.translate(x + 6, 10); ctx.scale(1.65, 1.65); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath(); ctx.roundRect(2.5, 1.5, 15, 21, 7.5); ctx.fillStyle = "rgba(24,23,19,.52)"; ctx.fill(); ctx.strokeStyle = "#f4eed8"; ctx.lineWidth = 1.25; ctx.stroke();
    const active = main.kind === "mouse" ? main.button : "middle";
    for (const [button, path] of [["left", "M3.2 8.8V7.2a5 5 0 0 1 5-5H9.5v6.6Z"], ["right", "M10.5 2.2h1.3a5 5 0 0 1 5 5v1.6h-6.3Z"], ["middle", "M10 3a1.8 1.8 0 0 1 1.8 1.8v3a1.8 1.8 0 0 1-3.6 0v-3A1.8 1.8 0 0 1 10 3Z"]] as const) {
      const shape = new Path2D(path); ctx.fillStyle = active === button ? "#f4eed8" : "rgba(244,238,216,.18)"; ctx.fill(shape); ctx.lineWidth = .85; ctx.stroke(shape);
    }
    ctx.restore();
    if (main.kind === "wheel") { ctx.font = `27px ${FONT}`; ctx.fillText(main.direction === "up" ? "↑" : "↓", x + 32, 44); }
  }
  return width;
}
