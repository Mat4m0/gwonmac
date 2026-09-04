/**
 * Owns pointer-transparent duration labels positioned over stock Effects icons.
 * It receives only validated CSS-space rectangles and never handles input.
 */
export type EffectTimerLabel = Readonly<{
  skillId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  urgency: "normal" | "soon" | "urgent";
}>;

const ROOT_STYLE = "position:fixed;inset:0;z-index:2;display:none;overflow:hidden;pointer-events:none;user-select:none";
const LABEL_STYLE = "position:absolute;display:flex;align-items:flex-end;justify-content:flex-end;box-sizing:border-box;padding:0 3px 2px 0;font-family:system-ui,sans-serif;font-weight:700;line-height:1;text-shadow:0 1px 2px #000,1px 0 1px #000,-1px 0 1px #000;pointer-events:none";

export function createEffectTimerOverlay(parent: HTMLElement) {
  const root = parent.ownerDocument.createElement("div");
  root.id = "effect-timer-overlay";
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = ROOT_STYLE;
  parent.append(root);
  let signature = "";

  return Object.freeze({
    update(labels: readonly EffectTimerLabel[] | null) {
      const next = labels === null ? "" : labels.map((label) =>
        `${label.skillId}:${label.x},${label.y},${label.width},${label.height}:${label.text}:${label.urgency}`
      ).join(";");
      if (next === signature) return;
      signature = next;
      root.replaceChildren();
      if (labels === null || labels.length === 0) {
        root.style.display = "none";
        return;
      }
      for (const label of labels) {
        const element = parent.ownerDocument.createElement("span");
        element.textContent = label.text;
        element.style.cssText = `${LABEL_STYLE};left:${label.x}px;top:${label.y}px;width:${label.width}px;height:${label.height}px;font-size:${Math.max(11, Math.min(18, label.height * 0.38))}px;color:${
          label.urgency === "urgent" ? "#c86c65" : label.urgency === "soon" ? "#e5ad52" : "#eadcc2"
        }`;
        root.append(element);
      }
      root.style.display = "block";
    },
    get state() { return Object.freeze({ visible: root.style.display === "block", signature }); },
    dispose() { root.remove(); },
  });
}
