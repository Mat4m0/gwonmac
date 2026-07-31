type ToolboxState = Readonly<{
  status: string;
  playerChatCount?: number;
  heroAvailable?: boolean;
  heroCount?: number;
  firstHeroId?: number;
  panelState?: number;
  commandRequest?: number;
  commandComplete?: number;
  commandStatus?: number;
}>;

const ROOT_STYLE = [
  "position:fixed",
  "right:18px",
  "bottom:18px",
  "z-index:4",
  "display:grid",
  "gap:8px",
  "min-width:238px",
  "padding:12px",
  "border:1px solid #59554b",
  "border-radius:4px",
  "color:#f0ece2",
  "background:#11100ee8",
  "font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
  "box-shadow:0 8px 24px #0008",
  "user-select:none",
].join(";");

const BUTTON_STYLE = [
  "padding:5px 10px",
  "border:1px solid #6b665b",
  "border-radius:3px",
  "color:inherit",
  "background:#292720",
  "font:inherit",
].join(";");

const PANEL_NAMES = ["unknown", "hidden", "shown"] as const;

export function createToolboxFoundation(
  parent: HTMLElement,
  setPanel: (shown: boolean) => number,
) {
  const document = parent.ownerDocument;
  const root = document.createElement("section");
  root.id = "toolbox-foundation";
  root.setAttribute("aria-label", "Toolbox foundation developer example");
  root.style.cssText = ROOT_STYLE;

  const chat = document.createElement("div");
  const hero = document.createElement("div");
  const panel = document.createElement("div");
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px";
  const hide = document.createElement("button");
  hide.type = "button";
  hide.textContent = "Hide panel";
  hide.style.cssText = BUTTON_STYLE;
  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "Show panel";
  show.style.cssText = BUTTON_STYLE;
  actions.append(hide, show);
  root.append(chat, hero, panel, actions);
  parent.append(root);

  let state: ToolboxState = Object.freeze({ status: "waiting" });
  const request = (shown: boolean) => {
    if (setPanel(shown) === 0) {
      panel.textContent = "Hero panel · command unavailable";
    }
  };
  hide.addEventListener("click", () => request(false));
  show.addEventListener("click", () => request(true));

  return {
    update(next: ToolboxState) {
      state = next;
      if (next.status !== "ready") {
        chat.textContent = "Player chat events · waiting";
        hero.textContent = "First owned hero · waiting";
        panel.textContent = "Hero panel · waiting";
        hide.disabled = true;
        show.disabled = true;
        return;
      }
      chat.textContent = `Player chat events · ${next.playerChatCount ?? 0}`;
      hero.textContent = next.heroAvailable
        ? `First owned hero · ${next.firstHeroId} (${next.heroCount} owned)`
        : "First owned hero · unavailable";
      const pending = next.commandRequest !== next.commandComplete;
      const command = pending
        ? " · pending"
        : next.commandStatus === 2
          ? " · unavailable"
          : "";
      panel.textContent =
        `Hero panel · ${PANEL_NAMES[next.panelState ?? 0] ?? "unknown"}${command}`;
      hide.disabled = !next.heroAvailable || pending;
      show.disabled = !next.heroAvailable || pending;
    },
    get state() {
      return state;
    },
    dispose() {
      root.remove();
    },
  };
}
