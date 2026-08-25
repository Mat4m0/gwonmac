/**
 * Project app-global preparation progress onto one renderer's launch gate.
 *
 * A playable client starts its complete-data download in the background. That
 * changes global progress to `image`, but it must not make a replacement
 * renderer wait for the background download to finish. The session's active
 * memory result is the canonical proof that this renderer can boot now.
 */
import type {
  ClientSession,
  DownloadProgress,
} from "../shared/contracts.js";

export function launchProgressForSession(
  progress: DownloadProgress,
  session: ClientSession,
): DownloadProgress {
  if (session.extendedMemory === null || progress.phase !== "image") {
    return progress;
  }
  return {
    ...progress,
    phase: "ready",
    label: "Starting Guild Wars",
  };
}
