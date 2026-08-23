/**
 * The skill-key HUD above Guild Wars' eight skill slots.
 *
 * This module owns presentation and rejects malformed display projections. It
 * does not discover game frames, read bindings, or translate input. Those
 * values must arrive from one certified game-owned source before this surface
 * is connected to the running client.
 */

const MAX_SLOT_COUNT = 8;
const MAX_COORDINATE = 32_768;
const MAX_SLOT_EDGE = 2_048;
const MAX_LABEL_CHARACTERS = 8;

const ROOT_STYLE = [
  "position:fixed",
  "inset:0",
  "z-index:3",
  "display:none",
  "overflow:hidden",
  "pointer-events:none",
  "user-select:none",
].join(";");

const SLOT_STYLE = "position:absolute;pointer-events:none";
const LABEL_STYLE = [
  "position:absolute",
  "display:flex",
  "align-items:center",
  "justify-content:center",
  "box-sizing:border-box",
  "padding:0 0.22em",
  "border:1px solid #e8e3c052",
  "border-radius:0.2em",
  "color:#fffdf3",
  "background:#484637f2",
  "box-shadow:inset 0 1px #ffffff1f,0 1px 2px #000b",
  "font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",sans-serif",
  "font-weight:650",
  "font-variant-numeric:tabular-nums",
  "line-height:1",
  "text-shadow:0 1px 1px #000",
  "-webkit-font-smoothing:antialiased",
].join(";");

export type SkillKeySlot = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}>;

export type SkillKeyOverlayState = Readonly<{
  status?: string;
  slots?: readonly unknown[];
}>;

function finiteBounded(value: unknown, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= maximum;
}

function skillKeySlot(value: unknown): SkillKeySlot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const slot = value as Record<string, unknown>;
  const { x, y, width, height, label } = slot;
  if (
    !finiteBounded(x, MAX_COORDINATE)
    || !finiteBounded(y, MAX_COORDINATE)
    || !finiteBounded(width, MAX_SLOT_EDGE)
    || !finiteBounded(height, MAX_SLOT_EDGE)
    || width <= 0
    || height <= 0
    || typeof label !== "string"
    || label !== label.trim()
    || label.length === 0
    || Array.from(label).length > MAX_LABEL_CHARACTERS
    || /[\p{Cc}\p{Cs}]/u.test(label)
  ) {
    return null;
  }
  return Object.freeze({ x, y, width, height, label });
}

/** Return the complete display projection, or nothing for a state we cannot
 * place safely. One bad slot hides the whole row instead of showing a binding
 * over the wrong skill. */
export function skillKeyOverlayProjection(
  state: SkillKeyOverlayState,
): readonly SkillKeySlot[] | null {
  if (
    state.status !== "ready"
    || !state.slots
    || state.slots.length === 0
    || state.slots.length > MAX_SLOT_COUNT
  ) return null;
  const slots: SkillKeySlot[] = [];
  for (const value of state.slots) {
    const slot = skillKeySlot(value);
    if (slot === null) return null;
    slots.push(slot);
  }
  return Object.freeze(slots);
}

function slotSignature(slots: readonly SkillKeySlot[]): string {
  return slots
    .map(({ x, y, width, height, label }) => `${x},${y},${width},${height},${label}`)
    .join(";");
}

/** Mount the pointer-transparent surface. The caller owns when it exists; this
 * owner touches the DOM only when the complete projection changes. */
export function createSkillKeyOverlay(parent: HTMLElement) {
  const document = parent.ownerDocument;
  const root = document.createElement("div");
  root.id = "skill-key-overlay";
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = ROOT_STYLE;

  const views = Array.from({ length: MAX_SLOT_COUNT }, () => {
    const slot = document.createElement("span");
    slot.style.cssText = SLOT_STYLE;
    const label = document.createElement("span");
    label.style.cssText = LABEL_STYLE;
    slot.append(label);
    root.append(slot);
    return { slot, label };
  });
  parent.append(root);

  let rendered = "";

  return {
    update(state: SkillKeyOverlayState) {
      const slots = skillKeyOverlayProjection(state);
      const next = slots === null ? "" : slotSignature(slots);
      if (next === rendered) return;
      rendered = next;
      if (slots === null) {
        root.style.display = "none";
        return;
      }
      slots.forEach((slot, index) => {
        const view = views[index]!;
        const edge = Math.min(slot.width, slot.height);
        const badgeEdge = Math.round(Math.min(42, Math.max(16, edge * 0.36)));
        const inset = Math.round(Math.max(2, edge * 0.04));
        view.slot.style.cssText = `${SLOT_STYLE};display:block;left:${slot.x}px;top:${slot.y}px;`
          + `width:${slot.width}px;height:${slot.height}px`;
        view.label.style.cssText = `${LABEL_STYLE};right:${inset}px;bottom:${inset}px;`
          + `min-width:${badgeEdge}px;height:${badgeEdge}px;font-size:${Math.round(badgeEdge * 0.68)}px`;
        view.label.textContent = slot.label;
      });
      views.slice(slots.length).forEach(({ slot }) => {
        slot.style.cssText = `${SLOT_STYLE};display:none`;
      });
      root.style.display = "block";
    },
    get state() {
      return Object.freeze({ visible: rendered !== "", signature: rendered });
    },
    dispose() {
      root.remove();
    },
  };
}
