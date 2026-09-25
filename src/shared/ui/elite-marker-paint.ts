/**
 * Paints Elite Skills markers the way Guild Wars presents an elite skill: the
 * inner skill artwork inside a gold frame. The native map texture and the
 * offline fixture share this one look, so fixture review matches the game.
 */
import type { EliteSceneMarker } from "../elite-map-scene.js";

/** A marker in canvas pixels. A direction in radians draws the off-view arrow. */
export type EliteMarkerPaint = Readonly<{ x: number; y: number; size: number; marker: EliteSceneMarker; direction: number | null }>;
export type EliteArtwork = Readonly<{ get(url: string | null): HTMLImageElement | null; readonly version: number; dispose(): void }>;

const GOLD = "#e8c15a";
const OUTLINE = "rgb(0 0 0 / 78%)";
const HOVER = "#fff4d6";
const WELL = "#15120d";
/** Client skill textures have a 4-pixel rim inside 64 pixels; show only the inner artwork. */
const RIM = 4 / 64;

/** Decodes each skill icon once. `changed` runs after an icon becomes drawable. */
export function createEliteArtwork(document: Document, changed: () => void): EliteArtwork {
  const images = new Map<string, HTMLImageElement | null>();
  let version = 0; let disposed = false;
  return {
    get(url) {
      if (!url) return null;
      if (!images.has(url)) {
        images.set(url, null);
        const image = document.createElement("img");
        image.decoding = "async"; image.src = url;
        void image.decode().then(() => {
          if (disposed || images.get(url) !== null) return;
          images.set(url, image); version += 1; changed();
        }, () => {});
      }
      return images.get(url) ?? null;
    },
    get version() { return version; },
    dispose() { disposed = true; images.clear(); },
  };
}

export function paintEliteMarker(context: CanvasRenderingContext2D, paint: EliteMarkerPaint, pixelRatio: number, artwork: EliteArtwork): void {
  const { x, y, size, marker, direction } = paint;
  const line = Math.max(1, Math.round(pixelRatio));
  const left = Math.round(x - size / 2); const top = Math.round(y - size / 2); const edge = Math.round(size);
  context.save();
  context.globalAlpha = marker.emphasis === "match" && !marker.hovered ? 0.92 : 1;
  if (direction !== null) paintArrow(context, x, y, size, direction, line);
  context.shadowColor = "rgb(0 0 0 / 55%)"; context.shadowBlur = 3 * line; context.shadowOffsetY = line;
  context.fillStyle = WELL; context.fillRect(left, top, edge, edge);
  context.shadowColor = "transparent";
  const image = artwork.get(marker.iconUrl);
  if (image) {
    const width = image.naturalWidth; const height = image.naturalHeight;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, width * RIM, height * RIM, width * (1 - RIM * 2), height * (1 - RIM * 2), left + line, top + line, edge - line * 2, edge - line * 2);
  } else {
    // A missing icon still reads as an elite capture point, never as a map cell.
    context.fillStyle = GOLD; context.beginPath();
    context.moveTo(x, top + edge * 0.25); context.lineTo(left + edge * 0.75, y); context.lineTo(x, top + edge * 0.75); context.lineTo(left + edge * 0.25, y);
    context.closePath(); context.fill();
  }
  context.lineWidth = line; context.strokeStyle = OUTLINE;
  context.strokeRect(left + line / 2, top + line / 2, edge - line, edge - line);
  if (marker.emphasis !== "match") {
    // Guild Wars marks an elite with a gold frame; the target frame is heavier.
    const frame = marker.emphasis === "target" ? line * 2 : line;
    context.lineWidth = frame; context.strokeStyle = GOLD;
    context.strokeRect(left + line + frame / 2, top + line + frame / 2, edge - line * 2 - frame, edge - line * 2 - frame);
  }
  if (marker.hovered) {
    context.lineWidth = line; context.strokeStyle = HOVER;
    context.strokeRect(left - line / 2, top - line / 2, edge + line, edge + line);
  }
  context.restore();
}

function paintArrow(context: CanvasRenderingContext2D, x: number, y: number, size: number, direction: number, line: number): void {
  const reach = size / 2 + 3 * line; const length = 7 * line; const half = 5 * line;
  const cos = Math.cos(direction); const sin = Math.sin(direction);
  const tipX = x + cos * (reach + length); const tipY = y + sin * (reach + length);
  const baseX = x + cos * reach; const baseY = y + sin * reach;
  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(baseX - sin * half, baseY + cos * half);
  context.lineTo(baseX + sin * half, baseY - cos * half);
  context.closePath();
  context.fillStyle = GOLD; context.fill();
  context.lineWidth = line; context.strokeStyle = OUTLINE; context.stroke();
}
