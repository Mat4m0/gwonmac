/**
 * The Electron owner for the unified profile workspace. It keeps profile
 * resources, launch sequencing, persistence, and destructive cleanup out of
 * the application composition root.
 */
import { dialog, session, type BrowserWindow } from "electron";
import { mkdir, rm } from "node:fs/promises";
import type {
  AccountProfileCreateRequest,
  AccountProfileUpdateRequest,
  AccountTemplateLibrary,
  AccountsState,
  TemplateExportEntry,
} from "../shared/contracts.js";
import {
  LEGACY_PRIMARY_PROFILE_ID,
  profileNameKey,
  type AccountWorkspace,
  type MultiWorkspace,
  type ProfileId,
} from "../shared/multiple-accounts.js";
import type { ClientRuntime } from "./client-runtime.js";
import {
  AccountTemplateSessions,
  loadAccountTemplateLibrary,
  saveAccountTemplateLibrary,
} from "./core/account-template-library.js";
import {
  AmbiguousAccountCreationError,
  createAccountProfile,
} from "./core/account-profile-creation.js";
import { CredentialsStore } from "./core/credentials.js";
import {
  archiveMultiProfile,
  beginArchivedProfileDeletion,
  removeArchivedMultiProfile,
  restoreMultiProfile,
  saveMultiWorkspace,
  updateMultiProfile,
} from "./core/multiple-accounts.js";
import { Mutex } from "./core/mutex.js";
import type { NativeKeychain } from "./core/native-keychain.js";
import { resolveProfileStorage } from "./core/profile-storage.js";
import {
  launchIssueForStage,
  ProfileRuntimeStore,
} from "./core/profile-runtime.js";
import { SteamSessionStore } from "./core/steam-session.js";
import { forgetRendererDiagnosticsOwner } from "./diagnostics.js";
import type { GamePaths } from "./paths.js";
import {
  installGwProtocolHandlerForSession,
  type ProtocolDeps,
} from "./protocol.js";
import { applyPendingSessionStorageReset } from "./settings-actions.js";
import {
  createMainWindow,
  prepareWindowState,
  resetRendererRecovery,
  setOwnedWindowTitle,
  type WindowHost,
} from "./window.js";
import { windowRegistry } from "./window-registry.js";
import type { WindowCoordinator } from "./window-coordinator.js";

export interface MultipleAccountsControllerOptions {
  readonly workspace: AccountWorkspace;
  readonly paths: GamePaths;
  readonly keychain: NativeKeychain;
  readonly clientRuntime: ClientRuntime;
  readonly protocol: ProtocolDeps;
  readonly windowHost: WindowHost;
  readonly windows: WindowCoordinator<BrowserWindow>;
  readonly publishState: (state: AccountsState) => void;
  /** Developer-only seam for synthetic clients in unsigned package tests. */
  readonly allowUnreadyLaunch?: boolean;
}

export class MultipleAccountsController {
  private readonly accountsLock = new Mutex();
  private readonly launchLock = new Mutex();
  private readonly templatesLock = new Mutex();
  private readonly templateSessions = new AccountTemplateSessions<BrowserWindow>();
  private readonly credentialsStores = new Map<string, CredentialsStore>();
  private readonly steamSessionStores = new Map<string, SteamSessionStore>();
  private readonly profileProtocolSessions = new Set<ProfileId>();
  private readonly diagnosticOwnerIds = new Map<ProfileId, number>();
  private readonly profileRuntime = new ProfileRuntimeStore();
  private nextDiagnosticOwnerId = 2;
  private workspace: AccountWorkspace;

  constructor(private readonly options: MultipleAccountsControllerOptions) {
    this.workspace = options.workspace;
  }

  private legacyName(): string {
    const used = new Set(this.workspace.profiles.map((profile) => profileNameKey(profile.name)));
    for (const candidate of ["Main account", "Main account (legacy)"]) {
      if (!used.has(profileNameKey(candidate))) return candidate;
    }
    let suffix = 2;
    while (used.has(profileNameKey(`Main account (legacy ${suffix})`))) suffix += 1;
    return `Main account (legacy ${suffix})`;
  }

  private profileName(profileId: ProfileId): string {
    if (this.workspace.legacyPrimaryProfileId === profileId) return this.legacyName();
    const profile = this.workspace.profiles.find((candidate) => candidate.id === profileId);
    if (!profile || profile.archived) throw new Error("Unknown account profile");
    return profile.name;
  }

  private publish(): void {
    this.options.publishState(this.state());
  }

  private diagnosticOwnerFor(profileId: ProfileId): number {
    if (profileId === LEGACY_PRIMARY_PROFILE_ID) return 1;
    const existing = this.diagnosticOwnerIds.get(profileId);
    if (existing !== undefined) return existing;
    const created = this.nextDiagnosticOwnerId++;
    this.diagnosticOwnerIds.set(profileId, created);
    return created;
  }

  private forgetDiagnosticOwner(profileId: ProfileId): void {
    const ownerId = this.diagnosticOwnerIds.get(profileId);
    if (ownerId !== undefined) forgetRendererDiagnosticsOwner(ownerId);
    this.diagnosticOwnerIds.delete(profileId);
    this.profileProtocolSessions.delete(profileId);
  }

  credentialsStoreFor(win: BrowserWindow): CredentialsStore {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    if (context?.role !== "game") throw new Error("game window has no profile");
    return this.credentialsForProfile(context.profileId);
  }

  steamSessionStoreFor(win: BrowserWindow): SteamSessionStore {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    if (context?.role !== "game") throw new Error("game window has no profile");
    return this.steamForProfile(context.profileId);
  }

  buildLibraryPathFor(win: BrowserWindow): string {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    if (context?.role !== "game") throw new Error("game window has no profile");
    return resolveProfileStorage(
      this.workspace,
      context.profileId,
      this.options.paths,
    ).buildLibrary;
  }

  gameStorageResetMarkerFor(win: BrowserWindow): string {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    if (context?.role !== "game") throw new Error("game window has no profile");
    return resolveProfileStorage(
      this.workspace,
      context.profileId,
      this.options.paths,
    ).gameStorageClearRequest;
  }

  state(): AccountsState {
    const legacy = this.workspace.legacyPrimaryProfileId;
    return {
      profiles: [
        ...(legacy
          ? [{
              id: legacy,
              name: this.legacyName(),
              templates: "private" as const,
              builds: "private" as const,
              archived: false,
              ...this.profileRuntime.get(legacy),
            }]
          : []),
        ...this.workspace.profiles
        .filter((profile) => !this.workspace.deletingProfileIds.includes(profile.id))
        .map((profile) => {
        const runtime = this.profileRuntime.get(profile.id);
        return {
          id: profile.id,
          name: profile.name,
          templates: profile.templates,
          builds: profile.builds,
          archived: profile.archived,
          state: runtime.state,
          ...(runtime.launchIssue ? { launchIssue: runtime.launchIssue } : {}),
        };
      }),
      ],
    };
  }

  /** Finish deletion journals left by a quit, crash, or temporary I/O failure. */
  async resumePendingDeletions(): Promise<void> {
    for (const profileId of this.workspace.deletingProfileIds) {
      await this.cleanupProfile(profileId);
      const next = removeArchivedMultiProfile(this.workspace, profileId) as AccountWorkspace;
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next;
      this.forgetDiagnosticOwner(profileId);
    }
    this.publish();
  }

  open(profileIds: readonly ProfileId[]): Promise<void> {
    return this.launchLock.run(() => this.openBatch(profileIds));
  }

  private async openBatch(profileIds: readonly ProfileId[]): Promise<void> {
    for (const profileId of profileIds) {
      resolveProfileStorage(this.workspace, profileId, this.options.paths);
      this.profileName(profileId);
    }
    if (
      !this.options.clientRuntime.active
      && !this.options.allowUnreadyLaunch
    ) {
      for (const profileId of profileIds) {
        this.profileRuntime.set(
          profileId,
          "failed",
          launchIssueForStage("validating"),
        );
      }
      this.publish();
      throw new Error("Guild Wars must be repaired before opening an account");
    }
    this.profileRuntime.queue(
      profileIds,
      (profileId) => windowRegistry.profileWindow(profileId) !== null,
    );
    this.publish();
    let canaryChecked = false;
    let firstFailure: unknown = null;
    let firstSelectedWindow: BrowserWindow | null = null;
    for (let index = 0; index < profileIds.length; index += 1) {
      const profileId = profileIds[index]!;
      let result: { readonly win: BrowserWindow; readonly opened: boolean };
      try {
        result = await this.accountsLock.run(() => this.openProfile(profileId, index));
        firstSelectedWindow ??= result.win;
      } catch (error) {
        firstFailure ??= error;
        continue;
      }
      if (result.opened && !canaryChecked) {
        if (this.options.clientRuntime.healthToken) {
          this.profileRuntime.set(profileId, "checking");
          try {
            await this.waitForCandidateCanary();
          } catch (error) {
            this.profileRuntime.set(
              profileId,
              "failed",
              launchIssueForStage("validating"),
            );
            this.profileRuntime.releaseQueued(profileIds.slice(index + 1));
            this.publish();
            this.options.windows.revealLauncher({ activateApp: true });
            throw error;
          }
        }
        this.profileRuntime.set(profileId, "running");
        canaryChecked = true;
      }
    }
    if (firstFailure) {
      this.publish();
      this.options.windows.revealLauncher({ activateApp: true });
      throw firstFailure;
    }
    if (firstSelectedWindow && !firstSelectedWindow.isDestroyed()) {
      this.options.windows.revealAsyncGameIfLauncherFocused(firstSelectedWindow);
    }
    this.publish();
  }

  create(request: AccountProfileCreateRequest): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const workspace = this.activeWorkspace();
      const { paths } = this.options;
      let next: MultiWorkspace;
      try {
        next = await createAccountProfile(workspace, {
          name: request.name,
          templates: "private",
          builds: "private",
          copySingleBuilds: false,
          copySingleTemplates: false,
        }, paths);
      } catch (error) {
        // Ambiguous publication refuses all follow-up mutation until restart;
        // the caller receives the failure and this controller keeps its last
        // known snapshot instead of inventing a second durable truth.
        if (error instanceof AmbiguousAccountCreationError) this.publish();
        throw error;
      }
      this.workspace = next as AccountWorkspace;
      this.publish();
      return this.state();
    });
  }

  update(request: AccountProfileUpdateRequest): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const workspace = this.activeWorkspace();
      if (request.id === workspace.legacyPrimaryProfileId) {
        throw new Error("The adopted Main account keeps its existing storage");
      }
      const current = this.profileFor(request.id);
      if (
        windowRegistry.profileWindow(request.id)
        && (current.builds !== request.builds || current.templates !== request.templates)
      ) {
        throw new Error("Close this account before changing sharing");
      }
      const next = updateMultiProfile(workspace, request.id, request);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next as AccountWorkspace;
      const profileWindow = windowRegistry.profileWindow(request.id);
      if (profileWindow) {
        setOwnedWindowTitle(profileWindow, `Guild Wars Reforged — ${request.name}`);
      }
      this.publish();
      return this.state();
    });
  }

  archive(profileId: ProfileId): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const workspace = this.activeWorkspace();
      if (profileId === workspace.legacyPrimaryProfileId) {
        throw new Error("The adopted Main account cannot be archived");
      }
      if (windowRegistry.profileWindow(profileId)) {
        throw new Error("Close this account before archiving it");
      }
      const next = archiveMultiProfile(workspace, profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next as AccountWorkspace;
      this.publish();
      return this.state();
    });
  }

  restore(profileId: ProfileId): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const next = restoreMultiProfile(this.activeWorkspace(), profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next as AccountWorkspace;
      this.publish();
      return this.state();
    });
  }

  delete(parent: BrowserWindow, profileId: ProfileId): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const workspace = this.activeWorkspace();
      const profile = workspace.profiles.find(
        (candidate) => candidate.id === profileId && candidate.archived,
      );
      if (!profile) throw new Error("Only an archived profile can be deleted");
      const { response } = await dialog.showMessageBox(parent, {
        type: "warning",
        buttons: ["Permanently Delete", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: `Permanently delete “${profile.name}”?`,
        detail:
          "Its saved login, Guild Wars files, private templates, builds, and window state cannot be recovered. Shared libraries and Single Account data stay untouched.",
      });
      if (response !== 0) return this.state();

      const pending = beginArchivedProfileDeletion(workspace, profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, pending);
      this.workspace = pending as AccountWorkspace;
      await this.cleanupProfile(profileId);
      const next = removeArchivedMultiProfile(pending, profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next as AccountWorkspace;
      this.forgetDiagnosticOwner(profileId);
      this.publish();
      return this.state();
    });
  }

  loadTemplates(win: BrowserWindow): Promise<AccountTemplateLibrary | null> {
    return this.templatesLock.run(async () => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      if (context?.role !== "game") return null;
      const storage = resolveProfileStorage(
        this.workspace,
        context.profileId,
        this.options.paths,
      );
      if (storage.templates === null) return null;
      const profile = this.profileFor(context.profileId);
      const library = await loadAccountTemplateLibrary(storage.templates);
      if (profile.templates === "shared") this.templateSessions.begin(win, library);
      else this.templateSessions.forget(win);
      return library;
    });
  }

  saveTemplates(win: BrowserWindow, entries: readonly TemplateExportEntry[]): Promise<void> {
    return this.templatesLock.run(async () => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      if (context?.role !== "game") return;
      const storage = resolveProfileStorage(
        this.workspace,
        context.profileId,
        this.options.paths,
      );
      if (storage.templates === null) return;
      const profile = this.profileFor(context.profileId);
      if (profile.templates === "private") {
        const current = await loadAccountTemplateLibrary(storage.templates);
        await saveAccountTemplateLibrary(storage.templates, {
          revision: current.revision + 1,
          entries,
        });
        return;
      }
      await this.templateSessions.save(win, entries, {
        loadLatest: () =>
          loadAccountTemplateLibrary(this.options.paths.multiSharedTemplates),
        publish: (library) =>
          saveAccountTemplateLibrary(this.options.paths.multiSharedTemplates, library),
      });
    });
  }

  private activeWorkspace(): MultiWorkspace {
    return this.workspace;
  }

  private profileFor(profileId: ProfileId) {
    const profile = this.workspace.profiles.find(
      (candidate) => candidate.id === profileId && !candidate.archived,
    );
    if (!profile) throw new Error("Unknown account profile");
    return profile;
  }

  private credentialsForProfile(profileId: ProfileId): CredentialsStore {
    const key = profileId;
    let store = this.credentialsStores.get(key);
    if (!store) {
      const storage = resolveProfileStorage(this.workspace, profileId, this.options.paths);
      store = new CredentialsStore(
        this.options.keychain,
        storage.credentialsSlot,
      );
      this.credentialsStores.set(key, store);
    }
    return store;
  }

  private steamForProfile(profileId: ProfileId): SteamSessionStore {
    const key = profileId;
    let store = this.steamSessionStores.get(key);
    if (!store) {
      const storage = resolveProfileStorage(this.workspace, profileId, this.options.paths);
      store = new SteamSessionStore(
        this.options.keychain,
        storage.steamSessionSlot,
      );
      this.steamSessionStores.set(key, store);
    }
    return store;
  }

  private async openProfile(
    profileId: ProfileId,
    newWindowOrdinal: number,
  ): Promise<{ readonly win: BrowserWindow; readonly opened: boolean }> {
    const storage = resolveProfileStorage(
      this.workspace,
      profileId,
      this.options.paths,
    );
    const profile = storage.kind === "isolated" ? this.profileFor(profileId) : null;
    let existing = windowRegistry.profileWindow(profileId);
    const previous = this.profileRuntime.get(profileId);
    if (previous.state === "failed") {
      resetRendererRecovery(storage.windowState);
      if (existing && !existing.isDestroyed()) existing.destroy();
      existing = null;
    }
    if (existing) {
      this.options.windows.revealGame(existing, { activateApp: true });
      return { win: existing, opened: false };
    }
    if (previous.state === "opening" || previous.state === "checking") {
      throw new Error("Account is already opening");
    }
    this.profileRuntime.set(profileId, "opening");
    this.publish();
    let failureStage: Parameters<typeof launchIssueForStage>[0] = "preparing";
    try {
      const owner = storage.session.kind === "default"
        ? session.defaultSession
        : session.fromPartition(storage.session.partition, { cache: false });
      if (!this.profileProtocolSessions.has(profileId)) {
        const diagnosticOwnerId = this.diagnosticOwnerFor(profileId);
        installGwProtocolHandlerForSession(owner, {
          ...this.options.protocol,
          diagnosticOwnerId: () => diagnosticOwnerId,
        });
        this.profileProtocolSessions.add(profileId);
      }
      await Promise.all([
        owner.clearStorageData({ storages: ["cookies"] }),
        owner.clearCache(),
      ]);
      const reset = await applyPendingSessionStorageReset(
        owner,
        storage.gameStorageClearRequest,
        this.diagnosticOwnerFor(profileId),
      );
      if (reset && storage.templates !== null && profile?.templates === "private") {
        await rm(storage.templates, { force: true });
      }
      if (storage.root !== null) await mkdir(storage.root, { recursive: true });
      await prepareWindowState(
        this.diagnosticOwnerFor(profileId),
        storage.windowState,
        newWindowOrdinal,
      );
      failureStage = "starting";
      let hubWasVisibleBeforeRecovery = false;
      const win = createMainWindow(this.options.windowHost, {
        context: { role: "game", profileId },
        diagnosticOwnerId: this.diagnosticOwnerFor(profileId),
        session: owner,
        title: `Guild Wars Reforged — ${this.profileName(profileId)}`,
        windowStatePath: storage.windowState,
        showInactive: true,
        onRendererRecoveryStart: () => {
          hubWasVisibleBeforeRecovery = windowRegistry.launcherWindow()?.isVisible() ?? false;
        },
        onRendererRecovered: () => {
          if (!hubWasVisibleBeforeRecovery) windowRegistry.launcherWindow()?.hide();
        },
        onRendererFailure: () => {
          this.profileRuntime.set(profileId, "failed", launchIssueForStage("crashed"));
          this.publish();
          this.options.windows.revealLauncher({ activateApp: true });
        },
        onProfileClosed: () => {
          if (this.profileRuntime.get(profileId).state !== "failed") {
            this.profileRuntime.set(profileId, "ready");
            this.publish();
          }
        },
      });
      await this.waitForWindow(win);
      this.profileRuntime.set(profileId, "running");
      this.publish();
      return { win, opened: true };
    } catch (error) {
      this.profileRuntime.set(profileId, "failed", launchIssueForStage(failureStage));
      this.publish();
      const failedWindow = windowRegistry.profileWindow(profileId);
      if (failedWindow && !failedWindow.isDestroyed()) failedWindow.destroy();
      throw error;
    }
  }

  private async waitForCandidateCanary(): Promise<void> {
    const candidate = this.options.clientRuntime.healthToken;
    if (!candidate) return;
    const deadline = Date.now() + 60_000;
    while (
      this.options.clientRuntime.healthToken === candidate
      && Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.options.clientRuntime.healthToken === candidate) {
      throw new Error("first profile did not confirm the new client generation");
    }
  }

  private async cleanupProfile(profileId: ProfileId): Promise<void> {
    const storage = resolveProfileStorage(this.workspace, profileId, this.options.paths);
    if (storage.kind === "legacy-primary") {
      throw new Error("The adopted Main account cannot be deleted");
    }
    const owner = session.fromPartition(storage.session.partition, { cache: false });
    await Promise.all([
      this.credentialsForProfile(profileId).clear(),
      this.steamForProfile(profileId).clear(),
      owner.clearStorageData(),
      owner.clearCache(),
    ]);
    await rm(storage.root, {
      recursive: true,
      force: true,
    });
    this.credentialsStores.delete(profileId);
    this.steamSessionStores.delete(profileId);
  }

  private waitForWindow(win: BrowserWindow): Promise<void> {
    return new Promise((resolve, reject) => {
      // `createMainWindow` starts navigation before it returns. A cached local
      // document can therefore finish before this listener is installed.
      if (!win.webContents.isLoadingMainFrame()) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("profile window did not finish loading"));
      }, 30_000);
      const cleanup = () => {
        clearTimeout(timeout);
        win.webContents.removeListener("did-finish-load", loaded);
        win.removeListener("closed", closed);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const closed = () => {
        cleanup();
        reject(new Error("profile window closed while loading"));
      };
      win.webContents.once("did-finish-load", loaded);
      win.once("closed", closed);
    });
  }
}
