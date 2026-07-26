/**
 * The target distance and range readout: the first Toolbox feature, decided in
 * `PRODUCT.md`. It is the last stage of the read-only pipeline — manifest →
 * transform/kernel → snapshot → decoder → here — and it asks the game for
 * nothing. One decoded snapshot in, two values out.
 *
 * There is deliberately no widget registry, event bus or command framework
 * behind it. A second feature can add one when it exists and needs it.
 */

/*
 * Top centre: the two other fixed overlays own the top corners (`#capture-status`
 * left, `#diagnostics` right), and the game's own target bar is up there, so
 * the number sits where the eye already is. Below both in the stack, and never
 * a pointer target — a HUD that can eat a click on the game surface is a bug.
 */
const ROOT_STYLE = [
  "position:fixed",
  "top:12px",
  "left:50%",
  "transform:translateX(-50%)",
  "z-index:2",
  "align-items:baseline",
  "gap:10px",
  "padding:4px 12px",
  "border:1px solid #444",
  "border-radius:2px",
  "color:#e8e8e8",
  "background:#080808d9",
  "font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
  "pointer-events:none",
  "user-select:none",
].join(";");
const LABEL_STYLE = "color:#9a9a9a;text-transform:uppercase";
const DISTANCE_STYLE = "font-size:15px;color:#f3dd9d";
const RANGE_STYLE = "color:#c9c9c9";

/**
 * The shape this reads out of a decoded snapshot. Everything is optional
 * because the decoder's waiting states carry none of it.
 * @typedef {{
 *   status?: string,
 *   targetValid?: boolean,
 *   distance?: number,
 *   rangeName?: string,
 * }} SnapshotState
 */

/**
 * What the readout says for a decoded snapshot, or `null` when it says
 * nothing. The distance is the snapshot's own value rounded to a whole game
 * unit: no unit is invented, no band is recomputed, and a state the decoder
 * did not certify as ready renders nothing at all.
 * @param {SnapshotState} state
 */
export function targetReadout(state) {
  if (state?.status !== "ready" || state.targetValid !== true) return null;
  const { distance, rangeName } = state;
  // The decoder guarantees both for a ready target; a readout that would
  // otherwise print `NaN` over someone's game shows nothing instead.
  if (!Number.isFinite(distance) || typeof rangeName !== "string") return null;
  return Object.freeze({
    distance: String(Math.round(Number(distance))),
    range: rangeName,
  });
}

/**
 * Mounts the readout and keeps it in step with the snapshot. Owns its own
 * element, so nothing else in the page has to know it exists.
 * @param {HTMLElement} parent
 */
export function createTargetReadout(parent) {
  const document = parent.ownerDocument;
  const root = document.createElement("div");
  root.id = "toolbox-target";
  // In the accessibility tree, but never announced: this changes every frame.
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "off");
  root.style.cssText = ROOT_STYLE;
  root.style.display = "none";

  const label = document.createElement("span");
  label.textContent = "Target";
  label.style.cssText = LABEL_STYLE;
  const distance = document.createElement("span");
  distance.style.cssText = DISTANCE_STYLE;
  const range = document.createElement("span");
  range.style.cssText = RANGE_STYLE;
  root.append(label, distance, range);
  parent.append(root);

  /** The rendered line, or the empty string while nothing is shown. */
  let rendered = "";

  return {
    /**
     * Called once per animation frame, so it touches the DOM only when the
     * text it would write has actually changed.
     * @param {SnapshotState} state
     */
    update(state) {
      const next = targetReadout(state);
      const line = next === null ? "" : `${next.distance} ${next.range}`;
      if (line === rendered) return;
      rendered = line;
      if (next === null) {
        root.style.display = "none";
        return;
      }
      distance.textContent = next.distance;
      range.textContent = next.range;
      root.style.display = "flex";
    },
    get state() {
      return Object.freeze({ visible: rendered !== "", line: rendered });
    },
    dispose() {
      root.remove();
    },
  };
}
