/**
 * The single owner of application updates: discovery, feed validation,
 * download, ready, and install.
 *
 * It is also the only caller of the releases API in this project.
 * `periodicCheckDue` holds every gate on an automatic check and is pure, so the
 * gates are provable without running a timer; an open game socket defers an
 * automatic check because a Squirrel download must not compete with live game
 * traffic.
 *
 * Only a package carrying the release marker may reach Squirrel.Mac. The
 * selected Stable/Beta track is read once per check. Stable admits only
 * stable releases; Beta additionally admits beta and RC releases. Alpha is
 * never eligible. The separately signed Preview tester app cannot reach this
 * owner. This owner never chooses when to restart: the launch gate may install
 * a ready update before play, while later readiness waits for user or ordinary
 * restart orchestration.
 */
import type {
  AppUpdateErrorCode,
  AppUpdateState,
} from "../shared/contracts.js";
import { RELEASE_REPO } from "../shared/contracts.js";
import { releaseAssetUrl } from "../shared/project-identity.js";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  isReleaseEligibleForTrack,
  parseReleaseVersion,
  releaseMetadataMatchesStage,
  type ReleaseVersion,
  type UpdateTrack,
} from "../shared/release.js";
import { redactDiagnosticText } from "./diagnostics/text-scan.js";

/**
 * Which of the two requests a check makes was the one that lost its answer.
 * The state a check publishes says only what went wrong, and the same reason
 * reads very differently for the releases list than for one release's feed.
 */
export type AppUpdateStage = "releases" | "feed";

const API_URL =
  `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=100`;
const TIMEOUT_MS = 5_000;

interface NativeUpdater {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
}

interface ReleaseAsset {
  name: string;
  url: string;
}

interface ReleaseCandidate {
  tag: string;
  version: ReleaseVersion;
  assets: ReleaseAsset[];
}

type FeedValidation =
  | { url: string }
  | { reason: AppUpdateErrorCode };

export interface AppUpdaterOptions {
  currentVersion: string;
  capable: boolean;
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
  recordFailure: (stage: AppUpdateStage, reason: AppUpdateErrorCode) => void;
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
    this.state = {
      phase: "idle",
      currentVersion: options.currentVersion,
    };
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
    if (!this.options.capable) {
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
        response = await this.fetchImpl(API_URL, {
          signal: controller.signal,
          headers: { accept: "application/vnd.github+json" },
        });
      } catch (error) {
        await this.failAndRemember(
          this.noteFailure(
            "releases",
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
          this.noteFailure("releases", "unreadable", error),
        );
        return;
      }
      const candidates = parseCandidates(body, track);
      if (candidates === null) {
        await this.failAndRemember(this.noteFailure("releases", "unreadable"));
        return;
      }
      const latest = candidates[0] ?? null;
      const checkedAtValue = this.now();
      const checkedAt = new Date(checkedAtValue).toISOString();
      await this.remember(checkedAtValue);
      if (!latest) {
        this.setState({
          phase: "up-to-date",
          currentVersion: this.options.currentVersion,
          latestVersion: this.options.currentVersion,
          checkedAt,
        });
        return;
      }

      const comparison = compareReleaseVersions(latest.version, current);
      if (
        track === "stable"
        && current.channel !== "stable"
        && comparison < 0
      ) {
        this.setState({
          phase: "manual-stable-return",
          currentVersion: this.options.currentVersion,
          checkedAt,
          stableVersion: formatReleaseVersion(latest.version),
        });
        return;
      }
      if (comparison <= 0) {
        this.setState({
          phase: "up-to-date",
          currentVersion: this.options.currentVersion,
          latestVersion: formatReleaseVersion(latest.version),
          checkedAt,
        });
        return;
      }

      const feed = await this.validatedFeed(latest, controller.signal);
      if ("reason" in feed) {
        this.fail(feed.reason, checkedAt);
        return;
      }
      const latestVersion = formatReleaseVersion(latest.version);
      // Publish the owned transition before calling native code. A synchronous
      // native event or refusal can then close this exact download instead of
      // racing a later transition back to `downloading`.
      this.setState({
        phase: "downloading",
        currentVersion: this.options.currentVersion,
        latestVersion,
        checkedAt,
      });
      try {
        this.options.nativeUpdater.setFeedURL({ url: feed.url });
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

  private async validatedFeed(
    release: ReleaseCandidate,
    signal: AbortSignal,
  ): Promise<FeedValidation> {
    const manifests = release.assets.filter((asset) => asset.name === "RELEASES.json");
    const expectedZip =
      `Guild-Wars-Reforged-${formatReleaseVersion(release.version)}-macOS-arm64.zip`;
    const zips = release.assets.filter((asset) => asset.name === expectedZip);
    if (manifests.length !== 1 || zips.length !== 1) {
      return { reason: "feed-invalid" };
    }
    const manifestUrl = releaseAssetUrl(release.tag, "RELEASES.json");
    if (manifests[0]?.url !== manifestUrl) return { reason: "feed-invalid" };
    const zip = zips[0];
    if (!zip || zip.url !== releaseAssetUrl(release.tag, zip.name)) {
      return { reason: "feed-invalid" };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(manifestUrl, { signal });
    } catch (error) {
      return {
        reason: this.noteFailure(
          "feed",
          signal.aborted ? "timeout" : "offline",
          error,
        ),
      };
    }
    if (isRateLimited(response)) return { reason: "rate-limited" };
    if (!response.ok) return { reason: "server" };
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return { reason: this.noteFailure("feed", "unreadable", error) };
    }
    return validManifest(
      body,
      formatReleaseVersion(release.version),
      release.tag,
      zip.url,
    )
      ? { url: manifestUrl }
      : { reason: "feed-invalid" };
  }

  /**
   * The one place a fault that stops a check is kept rather than dropped. The
   * stage and reason are bounded and reach diagnostics; an error is text this
   * process did not author, so it is redacted and goes no further than the
   * console. A body that parses as JSON but is not the document expected
   * raises none, and every stage still names itself.
   */
  private noteFailure(
    stage: AppUpdateStage,
    reason: AppUpdateErrorCode,
    error?: unknown,
  ): AppUpdateErrorCode {
    this.options.recordFailure(stage, reason);
    const summary = `Update check failed at ${stage}: ${reason}`;
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
    return "checkedAt" in this.state
      ? this.state.checkedAt
      : this.state.lastCheckedAt;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCandidates(
  body: unknown,
  track: UpdateTrack,
): ReleaseCandidate[] | null {
  if (!Array.isArray(body)) return null;
  const candidates: ReleaseCandidate[] = [];
  const versions = new Set<string>();
  for (const value of body) {
    // A missing or malformed publication flag is not evidence that a release
    // is public. This also keeps a staged approval draft out of both tracks.
    if (!isRecord(value) || value.draft !== false) continue;
    const tag = value.tag_name;
    if (typeof tag !== "string") continue;
    const version = parseReleaseVersion(tag);
    if (!version) continue;
    if (typeof value.prerelease !== "boolean") continue;
    // GitHub metadata and the canonical tag must describe the same release.
    // Refusing disagreement prevents an incorrectly flagged alpha or stable
    // build from crossing the selected-track boundary.
    if (!releaseMetadataMatchesStage(version, value.prerelease)) continue;
    if (!isReleaseEligibleForTrack(version, track)) continue;
    const canonical = formatReleaseVersion(version);
    if (versions.has(canonical)) return null;
    versions.add(canonical);
    if (!Array.isArray(value.assets)) return null;
    const assets: ReleaseAsset[] = [];
    for (const asset of value.assets) {
      if (
        !isRecord(asset)
        || typeof asset.name !== "string"
        || typeof asset.browser_download_url !== "string"
      ) return null;
      assets.push({ name: asset.name, url: asset.browser_download_url });
    }
    candidates.push({ tag, version, assets });
  }
  candidates.sort((a, b) => compareReleaseVersions(b.version, a.version));
  return candidates;
}

function validManifest(
  value: unknown,
  version: string,
  tag: string,
  zipUrl: string,
): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.join(",") === "name,notes,pub_date,tag,url,version"
    && value.url === zipUrl
    && value.name === `Guild Wars Reforged v${version}`
    && value.version === version
    && value.tag === tag
    && value.notes === ""
    && typeof value.pub_date === "string"
    && !Number.isNaN(Date.parse(value.pub_date))
  );
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
