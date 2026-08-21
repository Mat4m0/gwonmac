/**
 * The Electron owner for Multiple Accounts after startup has loaded its mode
 * and workspace. It keeps profile resources, launch sequencing, persistence,
 * and destructive cleanup out of the application composition root.
 */
import { app, dialog, session, type BrowserWindow } from "electron";
import { mkdir, rm } from "node:fs/promises";
import type {
  AccountProfileCreateRequest,
  AccountProfileUpdateRequest,
  AccountTemplateLibrary,
  AccountsSetupRequest,
  AccountsState,
  TemplateExportEntry,
} from "../shared/contracts.js";
import type {
  AccountMode,
  MultiWorkspace,
  ProfileId,
} from "../shared/multiple-accounts.js";
import {
  getAccountsWindow,
  revealAccountsWindow,
} from "./accounts-window.js";
import type { ClientRuntime } from "./client-runtime.js";
import {
  loadAccountTemplateLibrary,
  reconcileAccountTemplates,
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
  createMultiWorkspace,
  loadMultiWorkspace,
  removeArchivedMultiProfile,
  restoreMultiProfile,
  saveAccountMode,
  saveMultiWorkspace,
  updateMultiProfile,
} from "./core/multiple-accounts.js";
import { Mutex } from "./core/mutex.js";
import { multiSecretSlot, type NativeKeychain } from "./core/native-keychain.js";
import { multiProfilePaths } from "./core/paths.js";
import {
  launchIssueForStage,
  ProfileRuntimeStore,
} from "./core/profile-runtime.js";
import { SteamSessionStore } from "./core/steam-session.js";
import type { GamePaths } from "./paths.js";
import {
  installGwProtocolHandlerForSession,
  type ProtocolDeps,
} from "./protocol.js";
import { applyPendingSessionStorageReset } from "./settings-actions.js";
import {
  closeProfileWindow,
  createMainWindow,
  prepareWindowState,
  resetRendererRecovery,
  setOwnedWindowTitle,
  type WindowHost,
} from "./window.js";
import { windowRegistry } from "./window-registry.js";

export interface MultipleAccountsControllerOptions {
  readonly mode: AccountMode;
  readonly workspace: MultiWorkspace | null;
  readonly paths: GamePaths;
  readonly keychain: NativeKeychain;
  readonly clientRuntime: ClientRuntime;
  readonly protocol: ProtocolDeps;
  readonly windowHost: WindowHost;
}

export class MultipleAccountsController {
  private readonly accountsLock = new Mutex();
  private readonly templatesLock = new Mutex();
  private readonly credentialsStores = new Map<string, CredentialsStore>();
  private readonly steamSessionStores = new Map<string, SteamSessionStore>();
  private readonly profileProtocolSessions = new Set<ProfileId>();
  private readonly profileRuntime = new ProfileRuntimeStore();
  private workspace: MultiWorkspace | null;

  constructor(private readonly options: MultipleAccountsControllerOptions) {
    this.workspace = options.workspace;
  }

  credentialsStoreFor(win: BrowserWindow): CredentialsStore {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    return context?.mode === "multi" && context.role === "game"
      ? this.credentialsForProfile(context.profileId)
      : this.credentialsForProfile();
  }

  steamSessionStoreFor(win: BrowserWindow): SteamSessionStore {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    return context?.mode === "multi" && context.role === "game"
      ? this.steamForProfile(context.profileId)
      : this.steamForProfile();
  }

  buildLibraryPathFor(win: BrowserWindow): string {
    const { paths } = this.options;
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    if (context?.mode !== "multi" || context.role !== "game") {
      return paths.buildLibrary;
    }
    const profile = this.profileFor(context.profileId);
    return profile.builds === "shared"
      ? paths.multiSharedBuildLibrary
      : multiProfilePaths(paths, profile.id).buildLibrary;
  }

  gameStorageResetMarkerFor(win: BrowserWindow): string {
    const { paths } = this.options;
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    return context?.mode === "multi" && context.role === "game"
      ? multiProfilePaths(paths, context.profileId).gameStorageClearRequest
      : paths.gameStorageClearRequest;
  }

  state(): AccountsState {
    return {
      mode: this.options.mode,
      profiles: (this.workspace?.profiles ?? [])
        .filter((profile) => !this.workspace?.deletingProfileIds.includes(profile.id))
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
    };
  }

  async setup(request: AccountsSetupRequest): Promise<void> {
    const { mode, paths } = this.options;
    if (mode !== "single") {
      throw new Error("Multiple Accounts mode is already enabled");
    }
    this.workspace ??= await loadMultiWorkspace(paths.multiWorkspace);
    if (!this.workspace) {
      const candidate = createMultiWorkspace();
      await saveMultiWorkspace(paths.multiWorkspace, candidate);
      this.workspace = candidate;
    }
    if (this.workspace.profiles.length === 0) {
      await saveAccountTemplateLibrary(paths.multiSingleTemplateImport, {
        revision: 1,
        entries: request.templateEntries,
      });
    }
    await this.switchMode("multi");
  }

  async useSingleMode(): Promise<void> {
    await this.switchMode("single");
  }

  /** Finish deletion journals left by a quit, crash, or temporary I/O failure. */
  async resumePendingDeletions(): Promise<void> {
    for (const profileId of this.workspace?.deletingProfileIds ?? []) {
      await this.cleanupProfile(profileId);
      const next = removeArchivedMultiProfile(this.workspace!, profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next;
    }
  }

  async open(profileIds: readonly ProfileId[]): Promise<void> {
    for (const profileId of profileIds) this.profileFor(profileId);
    this.profileRuntime.queue(
      profileIds,
      (profileId) => windowRegistry.profileWindow(profileId) !== null,
    );
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
            revealAccountsWindow();
            throw error;
          }
        }
        this.profileRuntime.set(profileId, "running");
        canaryChecked = true;
      }
    }
    if (firstFailure) {
      revealAccountsWindow();
      throw firstFailure;
    }
    const hub = getAccountsWindow();
    if (hub && !hub.isDestroyed()) hub.hide();
    if (firstSelectedWindow && !firstSelectedWindow.isDestroyed()) {
      if (firstSelectedWindow.isMinimized()) firstSelectedWindow.restore();
      const focused = new Promise<void>((resolve) => {
        if (firstSelectedWindow.isFocused()) {
          resolve();
          return;
        }
        const timeout = setTimeout(resolve, 1_000);
        firstSelectedWindow.once("focus", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      firstSelectedWindow.show();
      app.focus({ steal: true });
      firstSelectedWindow.focus();
      await focused;
    }
  }

  create(request: AccountProfileCreateRequest): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const workspace = this.activeWorkspace();
      const { paths } = this.options;
      const firstAccount = workspace.profiles.length === 0;
      let next: MultiWorkspace;
      try {
        next = await createAccountProfile(workspace, request, paths);
      } catch (error) {
        if (error instanceof AmbiguousAccountCreationError) {
          // No later mutation may publish the stale in-memory workspace over a
          // profile whose final workspace rename may already have succeeded.
          this.workspace = null;
        }
        throw error;
      }
      this.workspace = next;
      if (firstAccount) {
        await rm(paths.multiSingleTemplateImport, { force: true }).catch(() => undefined);
      }
      return this.state();
    });
  }

  update(request: AccountProfileUpdateRequest): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const workspace = this.activeWorkspace();
      const current = this.profileFor(request.id);
      if (
        windowRegistry.profileWindow(request.id)
        && (current.builds !== request.builds || current.templates !== request.templates)
      ) {
        throw new Error("Close this account before changing sharing");
      }
      const next = updateMultiProfile(workspace, request.id, request);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next;
      const profileWindow = windowRegistry.profileWindow(request.id);
      if (profileWindow) {
        setOwnedWindowTitle(profileWindow, `Guild Wars Reforged — ${request.name}`);
      }
      return this.state();
    });
  }

  archive(profileId: ProfileId): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const workspace = this.activeWorkspace();
      if (windowRegistry.profileWindow(profileId)) {
        throw new Error("Close this account before archiving it");
      }
      const next = archiveMultiProfile(workspace, profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next;
      return this.state();
    });
  }

  restore(profileId: ProfileId): Promise<AccountsState> {
    return this.accountsLock.run(async () => {
      const next = restoreMultiProfile(this.activeWorkspace(), profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next;
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
      this.workspace = pending;
      await this.cleanupProfile(profileId);
      const next = removeArchivedMultiProfile(pending, profileId);
      await saveMultiWorkspace(this.options.paths.multiWorkspace, next);
      this.workspace = next;
      return this.state();
    });
  }

  async loadTemplates(win: BrowserWindow): Promise<AccountTemplateLibrary | null> {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    if (context?.mode !== "multi" || context.role !== "game") return null;
    const profile = this.profileFor(context.profileId);
    const profilePaths = multiProfilePaths(this.options.paths, profile.id);
    const libraryPath = profile.templates === "shared"
      ? this.options.paths.multiSharedTemplates
      : profilePaths.templates;
    const library = await loadAccountTemplateLibrary(libraryPath);
    await saveAccountTemplateLibrary(profilePaths.templateSync, library);
    return library;
  }

  saveTemplates(win: BrowserWindow, entries: readonly TemplateExportEntry[]): Promise<void> {
    return this.templatesLock.run(async () => {
      const context = windowRegistry.contextForWebContents(win.webContents.id);
      if (context?.mode !== "multi" || context.role !== "game") return;
      const profile = this.profileFor(context.profileId);
      const profilePaths = multiProfilePaths(this.options.paths, profile.id);
      if (profile.templates === "private") {
        const current = await loadAccountTemplateLibrary(profilePaths.templates);
        await saveAccountTemplateLibrary(profilePaths.templates, {
          revision: current.revision + 1,
          entries,
        });
        return;
      }
      const [base, latest] = await Promise.all([
        loadAccountTemplateLibrary(profilePaths.templateSync),
        loadAccountTemplateLibrary(this.options.paths.multiSharedTemplates),
      ]);
      const merged = {
        revision: latest.revision + 1,
        entries: reconcileAccountTemplates(base.entries, latest.entries, entries),
      };
      await saveAccountTemplateLibrary(this.options.paths.multiSharedTemplates, merged);
      await saveAccountTemplateLibrary(profilePaths.templateSync, merged);
    });
  }

  requestQuit(win: BrowserWindow): void {
    const context = windowRegistry.contextForWebContents(win.webContents.id);
    if (context?.mode === "multi") void closeProfileWindow(win);
    else app.quit();
  }

  private activeWorkspace(): MultiWorkspace {
    if (this.options.mode !== "multi" || !this.workspace) {
      throw new Error("Multiple Accounts mode is not active");
    }
    return this.workspace;
  }

  private profileFor(profileId: ProfileId) {
    const profile = this.workspace?.profiles.find(
      (candidate) => candidate.id === profileId && !candidate.archived,
    );
    if (!profile) throw new Error("Unknown Multiple Accounts profile");
    return profile;
  }

  private credentialsForProfile(profileId?: ProfileId): CredentialsStore {
    const key = profileId ?? "single";
    let store = this.credentialsStores.get(key);
    if (!store) {
      store = new CredentialsStore(
        this.options.keychain,
        profileId ? multiSecretSlot(profileId, "arenaNetCredentials") : "arenaNetCredentials",
      );
      this.credentialsStores.set(key, store);
    }
    return store;
  }

  private steamForProfile(profileId?: ProfileId): SteamSessionStore {
    const key = profileId ?? "single";
    let store = this.steamSessionStores.get(key);
    if (!store) {
      store = new SteamSessionStore(
        this.options.keychain,
        profileId ? multiSecretSlot(profileId, "steamSession") : "steamSession",
      );
      this.steamSessionStores.set(key, store);
    }
    return store;
  }

  private async openProfile(
    profileId: ProfileId,
    newWindowOrdinal: number,
  ): Promise<{ readonly win: BrowserWindow; readonly opened: boolean }> {
    const profile = this.profileFor(profileId);
    let existing = windowRegistry.profileWindow(profileId);
    const previous = this.profileRuntime.get(profileId);
    const profilePaths = multiProfilePaths(this.options.paths, profileId);
    if (previous.state === "failed") {
      resetRendererRecovery(profilePaths.windowState);
      if (existing && !existing.isDestroyed()) existing.destroy();
      existing = null;
    }
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      return { win: existing, opened: false };
    }
    if (previous.state === "opening" || previous.state === "checking") {
      throw new Error("Account is already opening");
    }
    this.profileRuntime.set(profileId, "opening");
    let failureStage: Parameters<typeof launchIssueForStage>[0] = "preparing";
    try {
      const owner = session.fromPartition(`persist:gw-multi-${profileId}`, {
        cache: false,
      });
      if (!this.profileProtocolSessions.has(profileId)) {
        installGwProtocolHandlerForSession(owner, this.options.protocol);
        this.profileProtocolSessions.add(profileId);
      }
      await Promise.all([
        owner.clearStorageData({ storages: ["cookies"] }),
        owner.clearCache(),
      ]);
      const reset = await applyPendingSessionStorageReset(
        owner,
        profilePaths.gameStorageClearRequest,
      );
      if (reset && profile.templates === "private") {
        await rm(profilePaths.templates, { force: true });
        await rm(profilePaths.templateSync, { force: true });
      }
      await mkdir(profilePaths.root, { recursive: true });
      await prepareWindowState(profilePaths.windowState, newWindowOrdinal);
      failureStage = "starting";
      let hubWasVisibleBeforeRecovery = false;
      const win = createMainWindow(this.options.windowHost, {
        context: { mode: "multi", role: "game", profileId },
        session: owner,
        title: `Guild Wars Reforged — ${profile.name}`,
        windowStatePath: profilePaths.windowState,
        showInactive: true,
        onRendererRecoveryStart: () => {
          hubWasVisibleBeforeRecovery = getAccountsWindow()?.isVisible() ?? false;
        },
        onRendererRecovered: () => {
          if (!hubWasVisibleBeforeRecovery) getAccountsWindow()?.hide();
        },
        onRendererFailure: () => {
          this.profileRuntime.set(profileId, "failed", launchIssueForStage("crashed"));
          revealAccountsWindow();
        },
      });
      win.on("closed", () => {
        const replacement = windowRegistry.profileWindow(profileId);
        if (replacement && replacement !== win) return;
        if (this.profileRuntime.get(profileId).state !== "failed") {
          this.profileRuntime.set(profileId, "ready");
        }
      });
      await this.waitForWindow(win);
      this.profileRuntime.set(profileId, "running");
      return { win, opened: true };
    } catch (error) {
      this.profileRuntime.set(profileId, "failed", launchIssueForStage(failureStage));
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

  private async switchMode(mode: AccountMode): Promise<void> {
    await saveAccountMode(this.options.paths.launcherMode, mode);
    app.relaunch();
    app.quit();
  }

  private async cleanupProfile(profileId: ProfileId): Promise<void> {
    const owner = session.fromPartition(`persist:gw-multi-${profileId}`, {
      cache: false,
    });
    await Promise.all([
      this.credentialsForProfile(profileId).clear(),
      this.steamForProfile(profileId).clear(),
      owner.clearStorageData(),
      owner.clearCache(),
    ]);
    await rm(multiProfilePaths(this.options.paths, profileId).root, {
      recursive: true,
      force: true,
    });
    this.credentialsStores.delete(profileId);
    this.steamSessionStores.delete(profileId);
  }

  private waitForWindow(win: BrowserWindow): Promise<void> {
    return new Promise((resolve, reject) => {
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
