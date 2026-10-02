/**
 * Owns the one "Leave this area?" step (D-27). Every Hub action that leaves an
 * explorable instance (Travel, Travel and invite, a character switch) asks it
 * with the same words, the same safe default and the same arming: Stay here
 * leads and has the keyboard, and "Leave and …" accepts nothing until it has
 * armed, and never the later click of a multi-click (HUB-242, HUB-027).
 */
import { armConfirmation } from "./surface-controller.js";
import type { HubViewMount } from "../shared/hub.js";

export type LeaveAreaCopy = Readonly<{ question: string; detail: string; leave: string }>;

/** The question, its consequence and the leave button, naming the place or character. */
export function leaveAreaCopy(action: "travel" | "switch", target: string): LeaveAreaCopy {
  return action === "travel"
    ? {
      question: `Leave this area and travel to ${target}?`,
      detail: "Travelling leaves this explorable area. You may lose progress in this instance.",
      leave: `Leave and travel to ${target}`,
    }
    : {
      question: `Leave this area and switch to ${target}?`,
      detail: "Switching characters will leave this explorable area. You may lose progress in this instance.",
      leave: `Leave and switch to ${target}`,
    };
}

/**
 * Wires the two choices: the leave button arms a moment after `arm()` and then
 * takes one deliberate press; ← and → move between the two buttons.
 */
export function bindLeaveAreaChoice(stay: HTMLButtonElement, leave: HTMLButtonElement) {
  const arming = armConfirmation(leave);
  const step = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.target !== stay && event.target !== leave) return;
    event.preventDefault();
    (event.key === "ArrowLeft" ? stay : leave).focus({ preventScroll: true });
  };
  stay.addEventListener("keydown", step);
  leave.addEventListener("keydown", step);
  return Object.freeze({
    /** Starts the arming window; Stay here takes the keyboard. */
    arm() { arming.arm(); stay.focus({ preventScroll: true }); },
    disarm: arming.disarm,
    accepts: arming.accepts,
    dispose() {
      arming.disarm();
      stay.removeEventListener("keydown", step);
      leave.removeEventListener("keydown", step);
    },
  });
}

type LeaveAreaHub = Readonly<{
  showView(title: string, mount: HubViewMount<HTMLElement>): void;
  close(): void;
}>;

/**
 * Asks on a Hub page of its own. Stay here, Esc and Back return to the page
 * that asked, with its query and selection. "Leave and …" runs `leave`, then
 * closes the Hub. The promise settles with the outcome: it resolves once
 * `leave` ran and rejects with an AbortError when the player stays, so an
 * action that waits on it (Travel and invite) stops and reports nothing.
 */
export function askLeaveArea(hub: LeaveAreaHub, copy: LeaveAreaCopy, leave: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stayed = () => {
      if (settled) return;
      settled = true;
      reject(new DOMException("The player stayed in the area.", "AbortError"));
    };
    hub.showView("Leave this area?", (target, back, footer) => {
      const doc = target.ownerDocument;
      const view = doc.createElement("section");
      view.className = "hub-leave-area";
      view.setAttribute("aria-labelledby", "leave-area-question");
      view.setAttribute("aria-describedby", "leave-area-detail");
      const heading = doc.createElement("h2");
      heading.id = "leave-area-question";
      heading.textContent = copy.question;
      const detail = doc.createElement("p");
      detail.id = "leave-area-detail";
      detail.textContent = copy.detail;
      const actions = doc.createElement("div");
      actions.className = "hub-leave-area-actions";
      const stayButton = doc.createElement("button");
      stayButton.type = "button";
      stayButton.className = "ui-button";
      stayButton.id = "leave-area-stay";
      stayButton.textContent = "Stay here";
      const leaveButton = doc.createElement("button");
      leaveButton.type = "button";
      leaveButton.className = "ui-button";
      leaveButton.id = "leave-area-leave";
      leaveButton.dataset.variant = "danger";
      leaveButton.textContent = copy.leave;
      actions.append(stayButton, leaveButton);
      view.append(heading, detail, actions);
      target.append(view);
      const choice = bindLeaveAreaChoice(stayButton, leaveButton);
      stayButton.addEventListener("click", () => back());
      leaveButton.addEventListener("click", (event) => {
        if (settled || !choice.accepts(event)) return;
        settled = true;
        choice.disarm();
        void leave().then(() => { hub.close(); resolve(); }, (error: unknown) => { back(); reject(error); });
      });
      // The footer names the safe choice, so Enter outside the buttons stays.
      footer.primary({ label: "Stay here", run: () => back() });
      choice.arm();
      return () => { choice.dispose(); view.remove(); stayed(); };
    });
  });
}
