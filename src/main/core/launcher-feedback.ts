/**
 * Sends one player-written launcher report to the project's Basin form. The
 * destination is fixed, and the body holds only the validated report plus the
 * app and macOS versions, so the renderer cannot add data or redirect it.
 */
import type { UpdateTrack } from "../../shared/contracts.js";
import type { LauncherFeedback } from "../../shared/launcher-contracts.js";

export const FEEDBACK_URL = "https://usebasin.com/f/191a244290c4";

export interface FeedbackContext {
  readonly appVersion: string;
  readonly updateTrack: UpdateTrack;
  readonly macosVersion: string;
}

export async function sendLauncherFeedback(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  feedback: LauncherFeedback,
  context: FeedbackContext,
): Promise<void> {
  const body = new URLSearchParams({
    kind: feedback.kind,
    message: feedback.message,
    ...(feedback.email ? { email: feedback.email } : {}),
    appVersion: context.appVersion,
    updateTrack: context.updateTrack,
    macosVersion: context.macosVersion,
  });
  const response = await fetch(FEEDBACK_URL, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  // Basin answers a JSON request with 200; anything else was not accepted.
  if (!response.ok) throw new Error(`feedback was refused with HTTP ${response.status}`);
}
