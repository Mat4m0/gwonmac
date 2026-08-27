/**
 * Pointer-transparent SVG presentation for the development Compass spike.
 * The caller supplies only a complete, already clipped CSS-space projection.
 */
import type {
  CompassPathingProjection,
} from "./compass-pathing-projection.js";

const SVG = "http://www.w3.org/2000/svg";
const ROOT_STYLE = [
  "position:fixed", "inset:0", "z-index:4", "display:none",
  "width:100%", "height:100%", "overflow:hidden",
  "pointer-events:none", "user-select:none",
].join(";");
const LINE_STYLE = "fill:none;stroke:#8fffd2;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round;opacity:.82;pointer-events:none";

function validProjection(value: CompassPathingProjection): boolean {
  const numbers = [
    value.generation, value.frameId, value.circle.centerX,
    value.circle.centerY, value.circle.radius,
    ...value.lines.flatMap((line) => [line.x1, line.y1, line.x2, line.y2]),
  ];
  return Number.isSafeInteger(value.generation)
    && value.generation > 0
    && Number.isSafeInteger(value.frameId)
    && value.frameId > 0
    && value.lines.length > 0
    && value.lines.length <= 16_384
    && numbers.every(Number.isFinite)
    && value.circle.radius > 0
    && value.circle.radius <= 16_384;
}

export function createCompassPathingOverlay(parent: HTMLElement) {
  const document = parent.ownerDocument;
  const root = document.createElementNS(SVG, "svg");
  root.id = "compass-pathing-spike-overlay";
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  root.style.cssText = ROOT_STYLE;
  parent.append(root);
  let signature = "";
  return Object.freeze({
    update(projection: CompassPathingProjection | null) {
      if (projection !== null && !validProjection(projection)) projection = null;
      const next = projection === null ? "" : JSON.stringify(projection);
      if (next === signature) return;
      signature = next;
      if (projection === null) {
        root.replaceChildren();
        root.style.display = "none";
        return;
      }
      const boundary = document.createElementNS(SVG, "circle");
      boundary.setAttribute("cx", String(projection.circle.centerX));
      boundary.setAttribute("cy", String(projection.circle.centerY));
      boundary.setAttribute("r", String(projection.circle.radius));
      boundary.setAttribute("style", "fill:none;stroke:#d6fff0;stroke-width:.75;opacity:.35;pointer-events:none");
      const lines = projection.lines.map((line) => {
        const element = document.createElementNS(SVG, "line");
        element.setAttribute("x1", String(line.x1));
        element.setAttribute("y1", String(line.y1));
        element.setAttribute("x2", String(line.x2));
        element.setAttribute("y2", String(line.y2));
        element.setAttribute("style", LINE_STYLE);
        return element;
      });
      root.replaceChildren(boundary, ...lines);
      root.style.display = "block";
    },
    get state() {
      return Object.freeze({ visible: signature !== "", signature });
    },
    dispose() { root.remove(); },
  });
}
