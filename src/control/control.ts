import type { ProfileSummary } from "../shared/contracts.js";

const form = document.querySelector<HTMLFormElement>("#add-profile")!;
const input = document.querySelector<HTMLInputElement>("#profile-label")!;
const message = document.querySelector<HTMLElement>("#message")!;
const list = document.querySelector<HTMLElement>("#profiles")!;
const template = document.querySelector<HTMLTemplateElement>(
  "#profile-template",
)!;

function report(error: unknown): void {
  message.textContent =
    error instanceof Error ? error.message : "The action could not be completed.";
}

async function act(operation: () => Promise<void>): Promise<void> {
  message.textContent = "";
  try {
    await operation();
    await refresh();
  } catch (error) {
    report(error);
  }
}

function button(
  root: DocumentFragment,
  action: string,
): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(
    `[data-action="${action}"]`,
  )!;
}

function render(profile: ProfileSummary): DocumentFragment {
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  fragment.querySelector<HTMLElement>(".profile-label")!.textContent =
    profile.label;
  fragment.querySelector<HTMLElement>(".profile-status")!.textContent =
    profile.status;
  const launch = button(fragment, "launch");
  launch.textContent = profile.status === "running" ? "Focus" : "Launch";
  launch.disabled =
    profile.status === "starting" || profile.status === "closing";
  launch.addEventListener("click", () => {
    void act(() => window.gwControl.profiles.launch(profile.id));
  });
  const close = button(fragment, "close");
  close.disabled = profile.status !== "running";
  close.addEventListener("click", () => {
    void act(() => window.gwControl.profiles.close(profile.id));
  });
  const rename = button(fragment, "rename");
  rename.disabled = profile.status !== "stopped";
  rename.addEventListener("click", () => {
    const label = window.prompt("Profile label", profile.label);
    if (label !== null) {
      void act(() => window.gwControl.profiles.rename(profile.id, label));
    }
  });
  const forget = button(fragment, "forget");
  forget.disabled = profile.status !== "stopped";
  forget.addEventListener("click", () => {
    if (window.confirm(`Forget the saved login for “${profile.label}”?`)) {
      void act(() => window.gwControl.profiles.forgetSavedLogin(profile.id));
    }
  });
  const trash = button(fragment, "trash");
  trash.disabled = profile.status !== "stopped";
  trash.addEventListener("click", () => {
    if (window.confirm(`Move “${profile.label}” to Trash after restart?`)) {
      void act(() => window.gwControl.profiles.moveToTrash(profile.id));
    }
  });
  return fragment;
}

async function refresh(): Promise<void> {
  const profiles = await window.gwControl.profiles.list();
  list.replaceChildren(...profiles.map(render));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const label = input.value;
  void act(async () => {
    await window.gwControl.profiles.create(label);
    input.value = "";
  });
});

window.gwControl.profiles.onChange(() => void refresh().catch(report));
void refresh().catch(report);
