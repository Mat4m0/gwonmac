/**
 * Shared native-style cooldown text used by the HUD and Settings preview.
 * Font, outline, optical position, scaling, and color stay identical in both.
 */
import {
  formatSkillCooldown,
  skillCooldownCssColor,
  type SkillCooldownColor,
} from "../shared/skill-cooldowns.js";
import { ensureGuildWarsFont } from "./appearance.js";

const STYLE_ID = "skill-cooldown-styles";
const STYLE = `
.skill-cooldown-label {
  --skill-cooldown-slot-height: 64px;
  --skill-cooldown-optical-x: -2%;
  --skill-cooldown-optical-y: -4%;
  --skill-cooldown-outline: #120d0a;
  --skill-cooldown-shadow: rgb(0 0 0 / 88%);
  display: flex;
  position: absolute;
  inset: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--skill-cooldown-color);
  font-family: "Guild Wars Original Display", "Guild Wars Original", "QTFrizQuad", Palatino, Georgia, serif;
  font-size: calc(var(--skill-cooldown-slot-height) * .56);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: .9;
  letter-spacing: -.025em;
  pointer-events: none;
  user-select: none;
  -webkit-font-smoothing: antialiased;
}
.skill-cooldown-label[hidden] { display: none; }
.skill-cooldown-glyph {
  display: block;
  max-width: 82%;
  overflow: hidden;
  transform: translate(var(--skill-cooldown-optical-x), var(--skill-cooldown-optical-y));
  -webkit-text-stroke: max(1px, calc(var(--skill-cooldown-slot-height) * .028)) var(--skill-cooldown-outline);
  paint-order: stroke fill;
  text-shadow:
    0 2px 2px var(--skill-cooldown-shadow),
    1px 0 1px var(--skill-cooldown-shadow),
    -1px 0 1px var(--skill-cooldown-shadow),
    0 -1px 1px var(--skill-cooldown-shadow);
  white-space: nowrap;
}
.skill-cooldown-label[data-decimal="true"] { font-size: calc(var(--skill-cooldown-slot-height) * .48); }
.skill-cooldown-label[data-long="true"] { font-size: calc(var(--skill-cooldown-slot-height) * .40); }
`;

function ensureStyles(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

export function createSkillCooldownView(parent: HTMLElement) {
  const document = parent.ownerDocument;
  ensureStyles(document);
  void ensureGuildWarsFont();
  const element = document.createElement("span");
  element.className = "skill-cooldown-label";
  element.setAttribute("aria-hidden", "true");
  const glyph = document.createElement("span");
  glyph.className = "skill-cooldown-glyph";
  element.append(glyph);
  parent.append(element);
  let signature = "";
  return Object.freeze({
    element,
    update(remainingMs: number, color: SkillCooldownColor) {
      const label = formatSkillCooldown(remainingMs);
      const cssColor = skillCooldownCssColor(color);
      const next = label === null ? "" : `${label}|${cssColor}`;
      if (signature === next) return;
      signature = next;
      element.hidden = label === null;
      if (label === null) return;
      glyph.textContent = label;
      element.style.setProperty("--skill-cooldown-color", cssColor);
      element.dataset.decimal = String(label.includes("."));
      element.dataset.long = String(label.length >= 4);
    },
  });
}
