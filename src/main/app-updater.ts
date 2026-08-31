/**
 * The single owner of application updates: discovery, feed validation,
 * download, ready, and install.
 *
 * `periodicCheckDue` holds every gate on an automatic check and is pure, so the
 * gates are provable without running a timer; an open game socket defers an
 * automatic check because a Squirrel download must not compete with live game
 * traffic. Release discovery reads one static channel document and never
 * spends a GitHub REST API request from the player's shared public IP.
 *
 * Only a package carrying the release marker may reach the native Squirrel
 * updater. Windows additionally verifies the running executable's
 * Authenticode trust before main creates this owner. The
 * selected Stable/Beta track is read once per check. Stable admits only
 * stable releases; Beta additionally admits beta and RC releases. Alpha is
 * never eligible. Ad-hoc developer builds carry no release marker and cannot
 * reach this owner. This owner never chooses when to restart: the launch gate
 * may install a ready update before play, while later readiness waits for user
 * or ordinary restart orchestration.
 */
import type {
  AppUpdateErrorCode,
  AppUpdateState,
} from "../shared/contracts.js";
import {
  appUpdateFeedUrls,
  type AppUpdateTarget,
} from "../shared/project-identity.js";
import {
  compareReleaseVersions,
  isReleaseEligibleForTrack,
  parseReleaseVersion,
  type UpdateTrack,
} from "../shared/release.js";
import { parseReleaseManifest } from "../shared/release-manifest.js";
import { redactDiagnosticText } from "./diagnostics/text-scan.js";

const TIMEOUT_MS = 5_000;

interface NativeUpdater {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}

export interface AppUpdaterOptions {
  currentVersion: string;
  capable: boolean;
  externallyManaged?: boolean;
  target: AppUpdateTarget | null;
  nativeUpdater: NativeUpdater;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  rememberCheckedAt: (checkedAt: number) => Promise<void>;
  publish: (state: AppUpdateState) => void;
  /**
   * Keeps the cause of a discarded transport or parse fault. Injected rather
   * than recorded here, so this class stays constructible without Electron.
   */
  recordFailure: (reason: AppUpdateErrorCode) => void;
}

export class AppUpdater {
  private readonly options: AppUpdaterOptions;
  private state: AppUpdateState;
  private inFlight: Promise<void> | null = null;
  private installStarted = false;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: AppUpdaterOptions) {
    this.options = options;
    // Resolve the platform fetch at request time. This keeps tests capable of
    // proving the real main-process network boundary without adding a second
    // updater implementation or a production-only transport hook.
    this.fetchImpl = options.fetch
      ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.state = options.externallyManaged
      ? { phase: "managed", currentVersion: options.currentVersion }
      : { phase: "idle", currentVersion: options.currentVersion };
  }

  getState(): AppUpdateState {
    return { ...this.state };
  }

  restoreLastCheckedAt(lastCheckedAt: number | null): void {
    if (
      this.state.phase !== "idle"
      || lastCheckedAt === null
      || !Number.isSafeInteger(lastCheckedAt)
      || lastCheckedAt < 0
    ) return;
    this.setState({
      phase: "idle",
      currentVersion: this.options.currentVersion,
      lastCheckedAt: new Date(lastCheckedAt).toISOString(),
    });
  }

  check(track: UpdateTrack): Promise<void> {
    if (this.state.phase === "managed") return Promise.resolve();
    if (
      this.inFlight
      || this.state.phase === "downloading"
      || this.state.phase === "ready"
    ) {
      return this.inFlight ?? Promise.resolve();
    }
    // Capture the canonical preference once. A settings change while this
    // request is running applies to the next check instead of changing the
    // meaning of a response halfway through validation.
    const operation = this.runCheck(track).finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  updateDownloaded(): void {
    if (this.state.phase !== "downloading") return;
    const downloading = this.state;
    // The native transition is complete. A late `error` or
    // `update-not-available` event belongs to no active download and must not
    // turn a ready update into a failure.
    this.setState({
      phase: "ready",
      currentVersion: this.options.currentVersion,
      latestVersion: downloading.latestVersion,
      checkedAt: downloading.checkedAt,
    });
  }

  updateFailed(): void {
    if (this.state.phase !== "downloading") return;
    this.fail("download-failed", this.state.checkedAt);
  }

  updateNotAvailable(): void {
    if (this.state.phase !== "downloading") return;
    this.fail("feed-invalid", this.state.checkedAt);
  }

  /**
   * Hands the already-ready update to Squirrel exactly once. `false` is a
   * terminal refusal for the caller that has already completed quit cleanup;
   * retrying inside that dismantled process would be unsafe.
   */
  quitAndInstall(): boolean {
    if (this.state.phase !== "ready" || this.installStarted) return false;
    this.installStarted = true;
    try {
      this.options.nativeUpdater.quitAndInstall();
      return true;
    } catch (error) {
      // Cleanup has already completed, so diagnostics are closed. Preserve the
      // native cause in the local developer console without reviving updater
      // state or exporting native prose.
      console.error("native update installation refused", error);
      return false;
    }
  }

  private async runCheck(track: UpdateTrack): Promise<void> {
    const previous = this.lastCheckedAt();
    this.setState({
      phase: "checking",
      currentVersion: this.options.currentVersion,
      ...(previous === undefined ? {} : { lastCheckedAt: previous }),
    });
    if (!this.options.capable || this.options.target === null) {
      await this.failAndRemember("updater-unavailable");
      return;
    }
    const current = parseReleaseVersion(this.options.currentVersion);
    if (!current) {
      await this.failAndRemember("unsupported-build");
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      try {
        response = await this.fetchImpl(
          appUpdateFeedUrls(this.options.target)[track],
          {
            signal: controller.signal,
            headers: { accept: "application/json" },
          },
        );
      } catch (error) {
        await this.failAndRemember(
          this.noteFailure(
            controller.signal.aborted ? "timeout" : "offline",
            error,
          ),
        );
        return;
      }
      if (isRateLimited(response)) {
        await this.failAndRemember("rate-limited");
        return;
      }
      if (!response.ok) {
        await this.failAndRemember("server");
        return;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        await this.failAndRemember(
          this.noteFailure("unreadable", error),
        );
        return;
      }
      const feed = parseReleaseManifest(body, this.options.target);
      if (
        !feed
        || !isReleaseEligibleForTrack(feed.releaseVersion, track)
      ) {
        await this.failAndRemember(this.noteFailure("feed-invalid"));
        return;
      }
      const checkedAtValue = this.now();
      const checkedAt = new Date(checkedAtValue).toISOString();
      await this.remember(checkedAtValue);
      const comparison = compareReleaseVersions(feed.releaseVersion, current);
      if (
        track === "stable"
        && current.channel !== "stable"
        && comparison < 0
      ) {
        this.setState({
          phase: "manual-stable-return",
          currentVersion: this.options.currentVersion,
          checkedAt,
          stableVersion: feed.manifest.version,
        });
        return;
      }
      if (comparison <= 0) {
        this.setState({
          phase: "up-to-date",
          currentVersion: this.options.currentVersion,
          latestVersion: feed.manifest.version,
          checkedAt,
        });
        return;
      }
      // Publish the owned transition before calling native code. A synchronous
      // native event or refusal can then close this exact download instead of
      // racing a later transition back to `downloading`.
      this.setState({
        phase: "downloading",
        currentVersion: this.options.currentVersion,
        latestVersion: feed.manifest.version,
        checkedAt,
      });
      try {
        // Squirrel reads the immutable release-owned copy after this owner has
        // validated the mutable channel pointer. A channel deployment between
        // these two operations therefore cannot retarget the active download.
        this.options.nativeUpdater.setFeedURL({ url: feed.immutableFeedUrl });
      } catch {
        this.updateFailed();
        return;
      }
      if (this.state.phase !== "downloading") return;
      try {
        this.options.nativeUpdater.checkForUpdates();
      } catch {
        this.updateFailed();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The one place a fault that stops a check is kept rather than dropped. The
   * The bounded reason reaches diagnostics; an error is text this
   * process did not author, so it is redacted and goes no further than the
   * console. Transport, JSON, and closed-contract failures all name the one
   * static-feed boundary without retaining provider prose.
   */
  private noteFailure(
    reason: AppUpdateErrorCode,
    error?: unknown,
  ): AppUpdateErrorCode {
    this.options.recordFailure(reason);
    const summary = `Update check failed at feed: ${reason}`;
    if (error === undefined) console.warn(summary);
    else console.warn(summary, redactDiagnosticText(String(error)));
    return reason;
  }

  private async remember(checkedAt: number): Promise<void> {
    try {
      await this.options.rememberCheckedAt(checkedAt);
    } catch {
      // The check answer remains truthful for this process even if its
      // presentation timestamp could not be persisted.
    }
  }

  private async failAndRemember(reason: AppUpdateErrorCode): Promise<void> {
    const checkedAtValue = this.now();
    await this.remember(checkedAtValue);
    this.fail(reason, new Date(checkedAtValue).toISOString());
  }

  private lastCheckedAt(): string | undefined {
    if ("checkedAt" in this.state) return this.state.checkedAt;
    return "lastCheckedAt" in this.state
      ? this.state.lastCheckedAt
      : undefined;
  }

  private fail(
    reason: AppUpdateErrorCode,
    lastCheckedAt: string | undefined,
  ): void {
    this.setState({
      phase: "failed",
      currentVersion: this.options.currentVersion,
      ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }),
      reason,
    });
  }

  private setState(state: AppUpdateState): void {
    this.state = state;
    this.options.publish({ ...state });
  }
}

export const PERIODIC_CHECK_TICK_MS = 30 * 60 * 1000;
export const PERIODIC_CHECK_DUE_MS = 6 * 60 * 60 * 1000;

export interface PeriodicCheckInput {
  capable: boolean;
  autoCheckUpdates: boolean;
  activeSockets: number;
  lastUpdateCheckAt: number | null;
  now: number;
}

/**
 * Whether a scheduler tick becomes an automatic check. Pure by design:
 * main.ts owns when ticks fire; this owns every gate, so the gates are
 * provable without timers. An open game socket defers the check — a
 * Squirrel zip download must not compete with live game traffic.
 */
export function periodicCheckDue(input: PeriodicCheckInput): boolean {
  if (!input.capable || !input.autoCheckUpdates) return false;
  if (input.activeSockets > 0) return false;
  if (input.lastUpdateCheckAt === null) return true;
  const elapsed = input.now - input.lastUpdateCheckAt;
  // A recorded check far in the future means the clock moved backwards;
  // waiting for it to become the past would suppress checks indefinitely.
  return elapsed >= PERIODIC_CHECK_DUE_MS || -elapsed >= PERIODIC_CHECK_DUE_MS;
}

function isRateLimited(response: Response): boolean {
  return response.status === 429
    || (
      response.status === 403
      && (
        response.headers.get("x-ratelimit-remaining") === "0"
        || response.headers.has("retry-after")
      )
    );
}
