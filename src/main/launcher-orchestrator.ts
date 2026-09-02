/**
 * Builds the launcher's revisioned read model and owns waiting launch intents.
 * It coordinates existing domain owners without persisting their state or
 * moving launch decisions into the renderer.
 */
import type {
  AccountsState,
  AppSettings,
  AppUpdateState,
  DownloadProgress,
} from "../shared/contracts.js";
import type {
  LauncherPreferencesPatch,
  LauncherSnapshot,
} from "../shared/launcher-contracts.js";
import type { ProfileId } from "../shared/multiple-accounts.js";
import type { LauncherStateStore } from "./core/launcher-state.js";
import { launcherToolSettings } from "./core/launcher-tools.js";

interface LauncherAccountsOwner {
  state(): AccountsState;
  validateOpenable(ids: readonly ProfileId[]): void;
  queue(ids: readonly ProfileId[]): void;
  releaseQueued(ids: readonly ProfileId[]): void;
  open(ids: readonly ProfileId[]): Promise<void>;
  isOpen(id: ProfileId): boolean;
  show(id: ProfileId): boolean;
}

export interface LauncherOrchestratorOptions {
  readonly accounts: LauncherAccountsOwner;
  readonly state: LauncherStateStore;
  readonly hasActiveClient: () => boolean;
  readonly getProgress: () => DownloadProgress;
  readonly getAppUpdate: () => AppUpdateState;
  readonly getSettings: () => AppSettings;
  readonly getNews: (track: AppSettings["updateTrack"], preferences: LauncherSnapshot["preferences"]) => LauncherSnapshot["news"];
  readonly toolsLoaded: () => boolean;
  readonly developmentFixtures: boolean;
  /** Unpackaged Electron tests only: lets renderer-focused suites bypass client preparation. */
  readonly allowUnreadyLaunch?: boolean;
  readonly publish: (snapshot: LauncherSnapshot) => void;
  readonly reportLaunchFailure?: (error: unknown) => void;
}

export class LauncherOrchestrator {
  private readonly options: LauncherOrchestratorOptions;
  private revision = 0;
  private pending: ProfileId[] = [];
  private draining: Promise<void> | null = null;

  constructor(options: LauncherOrchestratorOptions) {
    this.options = options;
  }

  snapshot(): LauncherSnapshot {
    const document = this.options.state.get();
    const accounts = this.options.accounts.state();
    const knownIds = new Set(accounts.profiles.filter((profile) => !profile.archived).map((profile) => profile.id));
    const selected = document.selectedProfileIds.filter((id) => knownIds.has(id));
    const selectedProfileIds = selected.length > 0
      ? selected
      : accounts.profiles.filter((profile) => !profile.archived).slice(0, 1).map((profile) => profile.id);
    const progress = this.options.getProgress();
    const readiness = this.readiness(progress);
    const settings = this.options.getSettings();
    const fixture = this.options.developmentFixtures ? "fixture" as const : "placeholder" as const;
    return {
      revision: this.revision,
      experience: {
        installationKind: document.installationKind,
        setup: document.setupVersion > 0 ? "complete" : "pending",
        introduction: document.introductionVersion > 0 ? "complete" : "pending",
        showMigrationNotice:
          document.installationKind !== "fresh" && !document.migrationNoticeDismissed,
        preferencesReset: document.preferencesResetPending,
      },
      readiness,
      appUpdate: this.options.getAppUpdate(),
      tools: {
        configured: settings.gwonmacTools,
        loaded: this.options.toolsLoaded(),
        restartRequired: settings.gwonmacTools !== this.options.toolsLoaded(),
        features: launcherToolSettings(settings),
      },
      settings: {
        autoCheckUpdates: settings.autoCheckUpdates,
        updateTrack: settings.updateTrack,
        renderScale: settings.renderScale,
        extendedMemoryEnabled: settings.extendedMemoryEnabled,
        showDiagnostics: settings.showDiagnostics,
        cartographyOverlayEnabled: settings.cartographyOverlayEnabled,
        cartographyGridEnabled: settings.cartographyGridEnabled,
        cartographyRevealMode: settings.cartographyRevealMode,
        cartographyPresetLibrary: settings.cartographyPresetLibrary,
        cartographyWalkabilityOpacity: settings.cartographyWalkabilityOpacity,
        cartographyGridOpacity: settings.cartographyGridOpacity,
        cartographyControlIdleOpacity: settings.cartographyControlIdleOpacity,
      },
      profiles: accounts.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        archived: profile.archived,
        state: profile.state,
        appearance: this.options.state.appearance(profile.id),
        ...(profile.launchIssue ? { failure: profile.launchIssue } : {}),
      })),
      selectedProfileIds,
      preferences: document.preferences,
      news: this.options.getNews(settings.updateTrack, document.preferences),
      contentAvailability: {
        news: fixture,
        dailies: fixture,
        knownIssues: fixture,
        feedback: fixture,
      },
    };
  }

  publish(): LauncherSnapshot {
    this.revision += 1;
    const snapshot = this.snapshot();
    this.options.publish(snapshot);
    return snapshot;
  }

  async setSelection(ids: readonly ProfileId[]): Promise<void> {
    this.options.accounts.validateOpenable(ids);
    await this.options.state.setSelection(ids);
    this.publish();
  }

  async play(ids: readonly ProfileId[]): Promise<void> {
    this.options.accounts.validateOpenable(ids);
    await this.options.state.setSelection(ids);
    const runtime = new Map(
      this.options.accounts.state().profiles.map((profile) => [profile.id, profile]),
    );
    const launchable = ids.filter((id) => {
      const profile = runtime.get(id);
      if (!profile || profile.archived) return false;
      if (profile.state === "failed") return true;
      return profile.state === "ready" && !this.options.accounts.isOpen(id);
    });
    if (launchable.length === 0) {
      this.publish();
      return;
    }
    if (this.options.hasActiveClient() || this.options.allowUnreadyLaunch) {
      await this.options.accounts.open(launchable);
      this.publish();
      return;
    }
    if (this.options.getProgress().phase === "error") {
      // Repair is one global launcher state, not a profile launch failure.
      // Keep the command idempotent so a stale renderer action cannot turn
      // that already-presented state into an unhandled IPC rejection.
      this.publish();
      return;
    }
    const pending = new Set(this.pending);
    for (const id of launchable) {
      if (!pending.has(id)) this.pending.push(id);
      pending.add(id);
    }
    this.options.accounts.queue(launchable);
    this.publish();
  }

  async show(id: ProfileId): Promise<void> {
    if (!this.options.accounts.show(id)) throw new Error("This account is not open");
    this.publish();
  }

  cancel(ids: readonly ProfileId[]): void {
    this.options.accounts.validateOpenable(ids);
    const cancelled = new Set(ids);
    this.pending = this.pending.filter((id) => !cancelled.has(id));
    this.options.accounts.releaseQueued(ids);
    this.publish();
  }

  clientChanged(): void {
    if (this.options.hasActiveClient()) {
      this.startDrain();
      this.publish();
      return;
    }
    if (this.options.getProgress().phase === "error" && this.pending.length > 0) {
      const released = this.pending;
      this.pending = [];
      this.options.accounts.releaseQueued(released);
      this.publish();
    }
  }

  async dismissMigrationNotice(): Promise<void> {
    await this.options.state.dismissMigrationNotice();
    this.publish();
  }

  async dismissPreferencesReset(): Promise<void> {
    await this.options.state.dismissPreferencesReset();
    this.publish();
  }

  async completeIntroduction(): Promise<void> {
    await this.options.state.completeIntroduction();
    this.publish();
  }

  async replayIntroduction(): Promise<void> {
    await this.options.state.replayIntroduction();
    this.publish();
  }

  async completeSetup(): Promise<void> {
    await this.options.state.completeSetup();
    this.publish();
  }

  async updateAppearance(profileId: ProfileId, appearance: LauncherSnapshot["profiles"][number]["appearance"]): Promise<void> {
    this.options.accounts.validateOpenable([profileId]);
    await this.options.state.updateAppearance(profileId, appearance);
    this.publish();
  }

  async updatePreferences(patch: LauncherPreferencesPatch): Promise<void> {
    await this.options.state.updatePreferences(patch);
    this.publish();
  }

  private readiness(progress: DownloadProgress): LauncherSnapshot["readiness"] {
    if (this.options.hasActiveClient()) {
      if (progress.phase !== "error" && progress.noticeCode === "offline-using-cached-client") {
        return { state: "offline-playable" };
      }
      return {
        state: "playable",
        backgroundDownload: progress.phase === "error"
          ? null
          : progress.fullDownload?.status === "running"
            ? {
                ...progress.fullDownload,
                received: progress.received,
                total: progress.total,
                bytesPerSecond: progress.bytesPerSecond,
                secondsRemaining: progress.secondsRemaining,
              }
            : progress.fullDownload ?? null,
        ...(progress.phase !== "error" && progress.noticeCode
          ? { notice: progress.noticeCode }
          : {}),
      };
    }
    if (progress.phase === "error") return { state: "repair-required", reason: progress.errorCode };
    return { state: "preparing", progress };
  }

  private startDrain(): void {
    if (this.draining || this.pending.length === 0) return;
    this.draining = (async () => {
      while (this.options.hasActiveClient() && this.pending.length > 0) {
        const profileId = this.pending.shift()!;
        try {
          await this.options.accounts.open([profileId]);
        } catch (error) {
          this.options.accounts.releaseQueued([profileId]);
          this.options.reportLaunchFailure?.(error);
        }
      }
    })().finally(() => {
      this.draining = null;
      this.publish();
      if (this.options.hasActiveClient() && this.pending.length > 0) this.startDrain();
    });
  }
}
