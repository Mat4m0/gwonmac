import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { fixtureSnapshot } from "../fixtures";
import GameFilesSettings from "./GameFilesSettings.vue";
import GeneralUpdateSettings from "./GeneralUpdateSettings.vue";
import { backgroundDownloadPresentation, playableNoticePresentation } from "../update-game-files-copy";

const noOp = async () => undefined;

describe("launcher update settings", () => {
  it("names launcher updates separately from Guild Wars game files", () => {
    const wrapper = mount(GeneralUpdateSettings, {
      props: {
        settings: fixtureSnapshot.settings,
        update: fixtureSnapshot.appUpdate,
        save: noOp,
        check: noOp,
        restart: noOp,
        openReleases: noOp,
      },
    });
    expect(wrapper.text()).toContain("Automatically update this launcher");
    expect(wrapper.text()).toContain("Guild Wars game files update separately");
  });

  it("opens Releases instead of looping a manual Stable return through Check now", async () => {
    const openReleases = vi.fn(noOp);
    const check = vi.fn(noOp);
    const wrapper = mount(GeneralUpdateSettings, {
      props: {
        settings: fixtureSnapshot.settings,
        update: {
          phase: "manual-stable-return",
          currentVersion: "2026.8.12-beta.1",
          checkedAt: "2026-08-29T12:00:00.000Z",
          stableVersion: "2026.8.11",
        },
        save: noOp,
        check,
        restart: noOp,
        openReleases,
      },
    });
    await wrapper.get("button").trigger("click");
    expect(wrapper.text()).toContain("Stable needs a manual install");
    expect(openReleases).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
  });

  it("gives bounded update failures the right next action", async () => {
    const openReleases = vi.fn(noOp);
    const wrapper = mount(GeneralUpdateSettings, {
      props: {
        settings: fixtureSnapshot.settings,
        update: {
          phase: "failed",
          currentVersion: "dev",
          reason: "updater-unavailable",
        },
        save: noOp,
        check: noOp,
        restart: noOp,
        openReleases,
      },
    });
    expect(wrapper.text()).toContain("cannot update itself");
    expect(wrapper.get("button").text()).toBe("Open Releases");
    await wrapper.get("button").trigger("click");
    expect(openReleases).toHaveBeenCalledOnce();
  });
});

describe("Game Files settings", () => {
  it("shows complete background download progress without blocking Play", () => {
    const wrapper = mount(GameFilesSettings, {
      props: {
        readiness: {
          state: "playable",
          backgroundDownload: {
            status: "running",
            received: 1024 ** 3,
            total: 2 * 1024 ** 3,
            bytesPerSecond: 16 * 1024 ** 2,
            secondsRemaining: 64,
          },
        },
        info: null,
        loading: false,
        repair: noOp,
        pause: noOp,
        resume: noOp,
        reset: noOp,
      },
    });
    expect(wrapper.text()).toContain("1.0 GB of 2.0 GB");
    expect(wrapper.text()).toContain("16 MB/s");
    expect(wrapper.text()).toContain("You can play now");
    expect(wrapper.get("progress").attributes("max")).toBe(String(2 * 1024 ** 3));
  });

  it("offers one clear recovery action with a reason-specific explanation", async () => {
    const repair = vi.fn(noOp);
    const wrapper = mount(GameFilesSettings, {
      props: {
        readiness: { state: "repair-required", reason: "disk_full" },
        info: null,
        loading: false,
        repair,
        pause: noOp,
        resume: noOp,
        reset: noOp,
      },
    });
    expect(wrapper.text()).toContain("not enough free space");
    expect(wrapper.findAll(".recovery-card button")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Try preparation again");
    await wrapper.get(".recovery-card button").trigger("click");
    expect(repair).toHaveBeenCalledOnce();
  });

  it("turns a failed background download code into an actionable sentence", async () => {
    const resume = vi.fn(noOp);
    const wrapper = mount(GameFilesSettings, {
      props: {
        readiness: {
          state: "playable",
          backgroundDownload: { status: "failed", errorCode: "net_offline" },
        },
        info: null,
        loading: false,
        repair: noOp,
        pause: noOp,
        resume,
        reset: noOp,
      },
    });
    expect(wrapper.text()).toContain("stopped because this computer is offline");
    await wrapper.get(".download-card button").trigger("click");
    expect(resume).toHaveBeenCalledOnce();
  });
});

describe("non-blocking game file banners", () => {
  it("keeps deliberate pauses visible without calling the game unready", () => {
    expect(backgroundDownloadPresentation({ status: "paused" })).toEqual({
      title: "Game file download paused",
      detail: "You can play now and resume the offline files when you are ready.",
    });
  });

  it("explains verified rollback while keeping readiness playable", () => {
    expect(playableNoticePresentation({
      state: "playable",
      backgroundDownload: null,
      notice: "rejected-candidate-fallback",
    })).toEqual({
      title: "Using the previous game client",
      detail: "A newer client did not start correctly. Your existing verified client is ready to play.",
    });
  });
});
