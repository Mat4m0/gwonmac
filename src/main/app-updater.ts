import type {
  AppUpdateErrorCode,
  AppUpdateState,
} from "../shared/contracts.js";
import { RELEASE_REPO } from "../shared/contracts.js";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  isOfferedUpgrade,
  isPrerelease,
  parseReleaseVersion,
  type ReleaseVersion,
} from "../shared/release.js";

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
}

export class AppUpdater {
  private readonly options: AppUpdaterOptions;
  private state: AppUpdateState;
  private inFlight: Promise<void> | null = null;
  private expectedDownload:
    | { latestVersion: string; checkedAt: string }
    | null = null;
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

  check(): Promise<void> {
    if (
      this.inFlight
      || this.state.phase === "downloading"
      || this.state.phase === "ready"
    ) {
      return this.inFlight ?? Promise.resolve();
    }
    const operation = this.runCheck().finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  updateDownloaded(): void {
    const expected = this.expectedDownload;
    if (!expected || this.state.phase !== "downloading") return;
    this.setState({
      phase: "ready",
      currentVersion: this.options.currentVersion,
      latestVersion: expected.latestVersion,
      checkedAt: expected.checkedAt,
    });
  }

  updateFailed(): void {
    if (!this.expectedDownload) return;
    const lastCheckedAt = this.expectedDownload.checkedAt;
    this.expectedDownload = null;
    this.fail("download-failed", lastCheckedAt);
  }

  updateNotAvailable(): void {
    if (!this.expectedDownload) return;
    const lastCheckedAt = this.expectedDownload.checkedAt;
    this.expectedDownload = null;
    this.fail("feed-invalid", lastCheckedAt);
  }

  quitAndInstall(): void {
    if (this.state.phase !== "ready" || this.installStarted) return;
    this.installStarted = true;
    this.options.nativeUpdater.quitAndInstall();
  }

  private async runCheck(): Promise<void> {
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
      } catch {
        await this.failAndRemember(
          controller.signal.aborted ? "timeout" : "offline",
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
      } catch {
        await this.failAndRemember("unreadable");
        return;
      }
      const candidates = parseCandidates(body, current);
      if (candidates === null) {
        await this.failAndRemember("unreadable");
        return;
      }
      const latest = candidates[0] ?? null;
      const checkedAtValue = this.now();
      const checkedAt = new Date(checkedAtValue).toISOString();
      await this.remember(checkedAtValue);
      if (!latest || !isOfferedUpgrade(current, latest.version)) {
        this.setState({
          phase: "up-to-date",
          currentVersion: this.options.currentVersion,
          latestVersion: latest
            ? formatReleaseVersion(latest.version)
            : this.options.currentVersion,
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
      this.expectedDownload = { latestVersion, checkedAt };
      this.options.nativeUpdater.setFeedURL({ url: feed.url });
      this.setState({
        phase: "downloading",
        currentVersion: this.options.currentVersion,
        latestVersion,
        checkedAt,
      });
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
    const zips = release.assets.filter((asset) => asset.name.endsWith(".zip"));
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
    } catch {
      return { reason: signal.aborted ? "timeout" : "offline" };
    }
    if (isRateLimited(response)) return { reason: "rate-limited" };
    if (!response.ok) return { reason: "server" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { reason: "unreadable" };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCandidates(
  body: unknown,
  current: ReleaseVersion,
): ReleaseCandidate[] | null {
  if (!Array.isArray(body)) return null;
  const candidates: ReleaseCandidate[] = [];
  for (const value of body) {
    if (!isRecord(value) || value.draft === true) continue;
    const tag = value.tag_name;
    if (typeof tag !== "string") continue;
    const version = parseReleaseVersion(tag);
    if (!version) continue;
    if (
      !isPrerelease(current)
      && (value.prerelease === true || isPrerelease(version))
    ) continue;
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

function releaseAssetUrl(tag: string, name: string): string {
  return `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
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
