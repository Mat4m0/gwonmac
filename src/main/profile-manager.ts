import type { BrowserWindow } from "electron";
import type { ProfileSummary } from "../shared/contracts.js";
import type {
  ProfileId,
  ProfileRecord,
  ProfileStore,
} from "./core/profiles.js";
import { parseProfileId } from "./core/profiles.js";
import { Mutex } from "./core/mutex.js";

interface GameWindowContext {
  readonly profileId: ProfileId;
  readonly window: BrowserWindow;
}

interface ProfileWindows {
  gameWindows(): readonly GameWindowContext[];
}

export interface ProfileManagerDeps {
  readonly store: ProfileStore;
  readonly windows: ProfileWindows;
  readonly launch: (profile: ProfileRecord) => Promise<void>;
  readonly close: (window: BrowserWindow) => Promise<void>;
  readonly confirmSwitch: (
    current: ProfileRecord,
    target: ProfileRecord,
  ) => Promise<boolean>;
  readonly restart: () => void;
  readonly notify: () => void;
}

/**
 * Serializes profile lifecycle commands without persisting a second state
 * machine. `running` is always derived from WindowRegistry; the two transient
 * values exist only while the command that owns the transition is pending.
 */
export class ProfileManager {
  private readonly deps: ProfileManagerDeps;
  private readonly lifecycle = new Mutex();
  private readonly transient = new Map<ProfileId, "starting" | "closing">();

  constructor(deps: ProfileManagerDeps) {
    this.deps = deps;
  }

  async list(): Promise<readonly ProfileSummary[]> {
    const { profiles } = await this.deps.store.scan();
    const running = new Set(
      this.deps.windows.gameWindows().map((context) => context.profileId),
    );
    return profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      status:
        this.transient.get(profile.id)
        ?? (running.has(profile.id) ? "running" : "stopped"),
    } satisfies ProfileSummary));
  }

  async create(label: string): Promise<void> {
    await this.deps.store.create(label);
    this.deps.notify();
  }

  async rename(id: ProfileId, label: string): Promise<void> {
    this.assertStopped(id);
    await this.deps.store.rename(id, label);
    this.deps.notify();
  }

  launch(id: ProfileId): Promise<void> {
    const canonicalId = parseProfileId(id);
    return this.lifecycle.run(async () => {
      const existing = this.game(canonicalId);
      if (existing) {
        this.focus(existing.window);
        return;
      }
      const profile = await this.profile(canonicalId);
      const current = this.deps.windows.gameWindows()[0];
      if (
        current
        && !(await this.deps.confirmSwitch(
          await this.profile(current.profileId),
          profile,
        ))
      ) {
        return;
      }
      this.transient.set(canonicalId, "starting");
      if (current) this.transient.set(current.profileId, "closing");
      this.deps.notify();
      try {
        if (current) {
          await this.deps.close(current.window);
          this.transient.delete(current.profileId);
          this.deps.notify();
        }
        await this.deps.launch(profile);
      } finally {
        this.transient.delete(canonicalId);
        if (current) this.transient.delete(current.profileId);
        this.deps.notify();
      }
    });
  }

  close(id: ProfileId): Promise<void> {
    const canonicalId = parseProfileId(id);
    return this.lifecycle.run(async () => {
      const context = this.game(canonicalId);
      if (!context) return;
      this.transient.set(canonicalId, "closing");
      this.deps.notify();
      try {
        await this.deps.close(context.window);
      } finally {
        this.transient.delete(canonicalId);
        this.deps.notify();
      }
    });
  }

  async forgetSavedLogin(id: ProfileId): Promise<void> {
    this.assertStopped(id);
    await this.deps.store.forgetSavedLogin(id);
    this.deps.notify();
  }

  async moveToTrash(id: ProfileId): Promise<void> {
    this.assertStopped(id);
    await this.deps.store.requestTrash(id, (candidate) =>
      Boolean(this.game(candidate)),
    );
    this.deps.restart();
  }

  private game(id: ProfileId): GameWindowContext | null {
    return (
      this.deps.windows.gameWindows().find(
        (context) => context.profileId === id,
      ) ?? null
    );
  }

  private assertStopped(id: ProfileId): void {
    const canonicalId = parseProfileId(id);
    if (this.game(canonicalId) || this.transient.has(canonicalId)) {
      throw new Error("profile must be stopped");
    }
  }

  private async profile(id: ProfileId): Promise<ProfileRecord> {
    const found = (await this.deps.store.scan()).profiles.find(
      (candidate) => candidate.id === id,
    );
    if (!found) throw new Error("profile does not exist");
    return found;
  }

  private focus(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }
}
