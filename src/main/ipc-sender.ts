/** The one rule for which window may call which IPC channel. */
import { isCanonicalRendererUrl, isLauncherRendererUrl, isSettingsRendererUrl } from "./core/renderer-trust.js";
import type { WindowContext, WindowRole } from "./window-registry.js";

/** The window roles a channel accepts. */
export type SenderRole = WindowRole | readonly WindowRole[] | "any";

/**
 * Why a sender is refused, or null when it may call a channel for `role`. The window's
 * role must be one the channel accepts, and its main frame must show that role's document.
 */
export function senderRefusal(role: SenderRole, context: WindowContext | null, mainFrame: boolean, url: string): string | null {
  const accepted = role === "any" || (typeof role === "string" ? role === context?.role : context !== null && role.includes(context.role));
  if (!context || !accepted) return "unowned ipc sender";
  if (!mainFrame) return "ipc sender is not the main frame";
  const trusted = context.role === "launcher" ? isLauncherRendererUrl(url)
    : context.role === "settings" ? isSettingsRendererUrl(url)
    : isCanonicalRendererUrl(url);
  return trusted ? null : "invalid ipc origin";
}
