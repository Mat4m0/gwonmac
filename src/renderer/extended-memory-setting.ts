import type { ExtendedMemoryRuntimeStatus } from "../shared/contracts.js";

export type ExtendedMemoryView = Readonly<{
  label: string;
  level: "neutral" | "good" | "warn";
  detail: string;
}>;

export function extendedMemoryView(
  savedIntent: boolean,
  runtime: ExtendedMemoryRuntimeStatus | null,
): ExtendedMemoryView {
  if (!runtime) {
    return savedIntent
      ? {
          label: "Checking compatibility…",
          level: "neutral",
          detail: "GWonMac will use 4 GB only after this Guild Wars build passes certification.",
        }
      : {
          label: "Using 2 GB",
          level: "neutral",
          detail: "The standard certified memory limit is active.",
        };
  }
  if (savedIntent !== runtime.requestedAtLaunch) {
    return {
      label: "Restart required",
      level: "warn",
      detail: `This session is still using ${runtime.effectiveCapBytes > 3_000_000_000 ? "4 GB" : "2 GB"}. Restart GWonMac to apply the saved choice.`,
    };
  }
  if (runtime.status === "active") {
    return {
      label: "Using 4 GB",
      level: "good",
      detail: "The certified 4 GB memory module is active for this session.",
    };
  }
  if (runtime.status === "unavailable") {
    return {
      label: "Unavailable for this Guild Wars update",
      level: "warn",
      detail: runtime.fallbackReason === "preparation-failed"
        ? "The 4 GB module could not be prepared safely. Guild Wars started normally with 2 GB; gameplay is not blocked."
        : "This Guild Wars build has not passed 4 GB certification yet. Guild Wars started normally with 2 GB; gameplay is not blocked.",
    };
  }
  return {
    label: "Using 2 GB",
    level: "neutral",
    detail: "The standard certified memory limit is active.",
  };
}

export function bindExtendedMemorySetting(document: Document): Readonly<{
  render(savedIntent: boolean, runtime: ExtendedMemoryRuntimeStatus | null): void;
}> {
  const badge = document.getElementById("settings-memory-badge");
  const status = document.getElementById("settings-memory-status");
  if (!badge || !status) throw new Error("missing extended-memory settings elements");
  return {
    render(savedIntent, runtime) {
      const view = extendedMemoryView(savedIntent, runtime);
      badge.textContent = view.label;
      badge.dataset.level = view.level;
      status.textContent = view.detail;
    },
  };
}
