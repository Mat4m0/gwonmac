/**
 * The one DOM projection of a saved skill-key binding. Settings and the live
 * HUD use the same segmented key plate so icons, abbreviations, and modifier
 * order cannot diverge.
 */
import {
  skillKeyPresentation,
  type SkillKeyBinding,
  type SkillKeyMainPresentation,
} from "../shared/skill-key-bindings.js";
import { ensureGuildWarsFont } from "./appearance.js";

const STYLE_ID = "skill-key-binding-styles";
const STYLE = `
.skill-key-plate {
  --skill-key-edge: 30px;
  display: inline-flex;
  align-items: stretch;
  height: var(--skill-key-edge);
  min-width: var(--skill-key-edge);
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  color: #f4eed8;
  border: 1px solid rgb(202 200 181 / 74%);
  border-radius: max(4px, calc(var(--skill-key-edge) * .20));
  background: linear-gradient(
    180deg,
    #c5c4ba 0%,
    #b4b3a7 10%,
    #898778 35%,
    #77765b 50%,
    #60573f 70%,
    #494533 85%,
    #3f3322 100%
  );
  box-shadow:
    inset 0 1px rgb(255 255 241 / 42%),
    inset 1px 0 rgb(255 255 241 / 18%),
    inset 0 -1px rgb(0 0 0 / 58%),
    0 0 0 1px rgb(19 18 14 / 88%),
    0 1px 2px rgb(0 0 0 / 72%);
  font-family: "Guild Wars Original Display", "Guild Wars Original", "QTFrizQuad", Palatino, Georgia, serif;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-shadow: 0 1px 0 #16140e, 1px 1px 1px #050504, -1px 0 1px #050504;
  -webkit-font-smoothing: antialiased;
}
.skill-key-plate-part {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: calc(var(--skill-key-edge) * .56);
  padding: 0 calc(var(--skill-key-edge) * .10);
  box-sizing: border-box;
  font-size: calc(var(--skill-key-edge) * .53);
}
.skill-key-main-glyph {
  display: inline-block;
  transform: translate(
    calc(var(--skill-key-edge) * .01),
    calc(var(--skill-key-edge) * .055)
  );
}
.skill-key-plate-part + .skill-key-plate-part {
  box-shadow: inset 1px 0 rgb(19 18 14 / 66%), -1px 0 rgb(255 255 241 / 12%);
}
.skill-key-plate-main {
  min-width: calc(var(--skill-key-edge) - 2px);
  font-size: calc(var(--skill-key-edge) * .76);
  padding-inline: calc(var(--skill-key-edge) * .16);
}
.skill-key-plate-main[data-wide="true"] {
  font-size: calc(var(--skill-key-edge) * .58);
}
.skill-key-plate-main[data-long="true"] {
  min-width: auto;
  font-size: calc(var(--skill-key-edge) * .45);
  padding-inline: calc(var(--skill-key-edge) * .20);
}
.skill-key-plate[data-compact="true"] .skill-key-plate-modifier {
  min-width: calc(var(--skill-key-edge) * .42);
  padding-inline: calc(var(--skill-key-edge) * .035);
  font-size: calc(var(--skill-key-edge) * .46);
}
.skill-key-plate[data-compact="true"] .skill-key-plate-main {
  min-width: calc(var(--skill-key-edge) * .82);
  padding-inline: calc(var(--skill-key-edge) * .09);
}
.skill-key-plate[data-compact="true"] .skill-key-plate-main[data-long="true"] {
  font-size: calc(var(--skill-key-edge) * .42);
}
.skill-key-mouse {
  width: calc(var(--skill-key-edge) * .56);
  height: calc(var(--skill-key-edge) * .70);
  overflow: visible;
}
.skill-key-mouse-outline { fill: rgb(24 23 19 / 52%); stroke: currentColor; stroke-width: 1.25; }
.skill-key-mouse-button { fill: rgb(244 238 216 / 18%); stroke: currentColor; stroke-width: .85; }
.skill-key-mouse-button[data-active="true"] { fill: currentColor; }
.skill-key-wheel-direction {
  margin-left: calc(var(--skill-key-edge) * .02);
  font-size: calc(var(--skill-key-edge) * .42);
}
.settings-skill-key-preview .skill-key-plate { --skill-key-edge: 30px; }
`;

function ensureStyles(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

function mouseIcon(
  document: Document,
  main: Extract<SkillKeyMainPresentation, { kind: "mouse" | "wheel" }>,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("skill-key-mouse");
  const shape = (tag: "path" | "rect", className: string, attributes: Record<string, string>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    node.setAttribute("class", className);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
    return node;
  };
  shape("rect", "skill-key-mouse-outline", {
    x: "2.5", y: "1.5", width: "15", height: "21", rx: "7.5",
  });
  const active = main.kind === "mouse" ? main.button : "middle";
  const left = shape("path", "skill-key-mouse-button", {
    d: "M3.2 8.8V7.2a5 5 0 0 1 5-5H9.5v6.6Z",
  });
  const right = shape("path", "skill-key-mouse-button", {
    d: "M10.5 2.2h1.3a5 5 0 0 1 5 5v1.6h-6.3Z",
  });
  const middle = shape("rect", "skill-key-mouse-button", {
    x: "8.2", y: "3", width: "3.6", height: "6.6", rx: "1.8",
  });
  ({ left, right, middle }[active]).dataset.active = "true";
  return svg;
}

export function createSkillKeyBindingView(parent: HTMLElement) {
  const document = parent.ownerDocument;
  ensureStyles(document);
  void ensureGuildWarsFont();
  const plate = document.createElement("span");
  plate.className = "skill-key-plate";
  plate.setAttribute("aria-hidden", "true");
  parent.append(plate);
  let signature = "";

  return Object.freeze({
    element: plate,
    update(binding: SkillKeyBinding | null) {
      const next = binding === null ? "" : JSON.stringify(binding);
      if (next === signature) return;
      signature = next;
      plate.replaceChildren();
      plate.hidden = binding === null;
      if (binding === null) return;
      const presentation = skillKeyPresentation(binding);
      plate.dataset.compact = String(presentation.modifiers.length >= 3);
      for (const glyph of presentation.modifiers) {
        const part = document.createElement("span");
        part.className = "skill-key-plate-part skill-key-plate-modifier";
        part.textContent = glyph;
        plate.append(part);
      }
      const main = document.createElement("span");
      main.className = "skill-key-plate-part skill-key-plate-main";
      if (presentation.main.kind === "text") {
        const glyph = document.createElement("span");
        glyph.className = "skill-key-main-glyph";
        glyph.textContent = presentation.main.label;
        main.append(glyph);
        main.dataset.wide = String(presentation.main.label.length > 1);
        main.dataset.long = String(presentation.main.label.length > 2);
      } else {
        main.append(mouseIcon(document, presentation.main));
        if (presentation.main.kind === "wheel") {
          const direction = document.createElement("span");
          direction.className = "skill-key-wheel-direction";
          direction.textContent = presentation.main.direction === "up" ? "↑" : "↓";
          main.append(direction);
        }
      }
      plate.append(main);
      plate.title = presentation.accessibleLabel;
    },
  });
}
