import { describe, expect, it } from "vitest";
import { LEGACY_PRIMARY_PROFILE_ID } from "@shared/multiple-accounts";
import type { LauncherProfileSummary } from "@shared/launcher-contracts";
import { cacheSummary, formatProgress, launchLabel, profileStatus, updateStatus } from "./launcher-view-model";

const profile = (state: LauncherProfileSummary["state"], failure?: LauncherProfileSummary["failure"]): LauncherProfileSummary => ({
  id: LEGACY_PRIMARY_PROFILE_ID,
  name: "Main account",
  archived: false,
  state,
  appearance: { icon: "swords", color: "#8a5a32" },
  ...(failure ? { failure } : {}),
});

describe("launcher view model", () => {
  it("counts only closed accounts in the primary action", () => {
    expect(launchLabel([profile("running"), profile("ready"), profile("ready")], { state: "playable", backgroundDownload: null })).toBe("Open 2 accounts");
    expect(launchLabel([profile("running"), profile("running")], { state: "playable", backgroundDownload: null })).toBe("Accounts are open");
    expect(launchLabel([profile("running")], { state: "playable", backgroundDownload: null })).toBe("Show");
  });

  it("describes queued and in-progress launches without offering Play again", () => {
    expect(launchLabel([profile("queued")], { state: "preparing", progress: { phase: "starting", label: "Checking", received: 0, total: 0, bytesPerSecond: 0, secondsRemaining: null } })).toBe("Cancel waiting");
    expect(launchLabel([profile("opening")], { state: "playable", backgroundDownload: null })).toBe("Opening account…");
    expect(launchLabel([profile("checking"), profile("running")], { state: "playable", backgroundDownload: null })).toBe("Checking game windows…");
  });

  it("uses specific local failure copy", () => {
    expect(profileStatus(profile("failed", "renderer-crash"))).toBe("Game window closed unexpectedly");
    expect(profileStatus(profile("checking"))).toBe("Checking the game window");
  });

  it("formats real download, cache, and update state", () => {
    expect(formatProgress({ phase: "client", label: "Downloading", received: 1024 ** 3, total: 2 * 1024 ** 3, bytesPerSecond: 1024 ** 2, secondsRemaining: 90 })).toBe("1.0 GB of 2.0 GB · 1.0 MB/s · 2 min left");
    expect(cacheSummary({ bytes: 1024 ** 3, chunks: 10, totalBytes: 2 * 1024 ** 3, totalChunks: 20, freeBytes: 0, fullDownloadShortfall: 0 })).toBe("1.0 GB of 2.0 GB verified");
    expect(updateStatus({ phase: "failed", currentVersion: "1", reason: "offline" })).toEqual({ title: "Could not check for updates", detail: "Try again when you are online." });
  });
});
