import { BrowserWindow, session, type Session } from "electron";
import { randomUUID } from "node:crypto";
import {
  buildAuthUrl,
  isAllowedOrigin,
  isRedirectTarget,
  newState,
  parseRedirect,
  type SteamOAuthConfig,
} from "./core/steam-oauth.js";

export type SteamAcquireResult =
  | { ok: true; token: string }
  | { ok: false; reason: "cancelled" | "state-mismatch" | "no-token" | "failed" };

/**
 * What the window did, reported as outcomes for the caller to record.
 *
 * Handed out rather than logged here so this module owns no diagnostics
 * vocabulary, and so a test can assert on what happened instead of on a spy.
 * Nothing in here carries a token, an identifier, or an expiry (R20).
 */
export type SteamAcquireEvent =
  | { k: "opened" }
  | { k: "blocked"; what: "navigation" | "popup" | "download" | "webview" }
  | {
      k: "settled";
      outcome: "success" | "cancelled" | "state-mismatch" | "no-token" | "failed";
    };

export interface SteamAcquireOptions {
  /** The game window, when there is one, so the sign-in window belongs to it. */
  parent?: BrowserWindow | null;
  record?: (event: SteamAcquireEvent) => void;
}

/**
 * Open a hardened window the main process owns, run the Steam OAuth2 implicit
 * flow in it, and return the access token it yields.
 *
 * The window matches or beats the game window's posture (KTD8): its own
 * in-memory session partition, no preload and no Node, deny-by-default
 * permission and download handlers, no popups and no webviews, and navigation
 * confined to the fail-closed allowlist derived from `config`. The redirect
 * that carries the token is intercepted *before it is fetched*, its `state` is
 * checked against the value generated for this attempt, and the window and its
 * whole partition are destroyed the moment sign-in ends — success, refusal, or
 * cancellation alike (R19).
 *
 * Never throws into the caller: a player whose sign-in failed belongs back at
 * the client's login screen, not looking at an unhandled rejection.
 */
/**
 * Build the partition and the window together, so a failure to construct either
 * is one thing the caller can catch. Separated out because everything here runs
 * *before* the promise that owns the resolve-only contract below: a throw at
 * this point would escape as a rejection, which is exactly what
 * `acquireSteamToken` promises not to do.
 */
function createSignInWindow(
  config: SteamOAuthConfig,
  parent: BrowserWindow | null | undefined,
  record: (event: SteamAcquireEvent) => void,
): { signIn: Session; win: BrowserWindow } {
  // No `persist:` prefix, so the partition lives in memory only and shares
  // nothing with the game session or with a previous attempt.
  const signIn = session.fromPartition(`steam-signin-${randomUUID()}`, {
    cache: false,
  });

  // Deny-by-default, matching the game window: no permission is granted, no
  // permission check passes, and no download is allowed to start (R16).
  signIn.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  signIn.setPermissionCheckHandler(() => false);
  signIn.on("will-download", (event) => {
    event.preventDefault();
    record({ k: "blocked", what: "download" });
  });

  const win = new BrowserWindow({
    width: 520,
    height: 720,
    title: `Steam sign-in — ${new URL(config.authorizationBaseUrl).origin}`,
    show: false,
    // Parented but deliberately *not* modal. On macOS a modal child is
    // presented as a sheet attached to its parent, and a sheet draws no title
    // bar — which is where R18 puts the live origin and where `docs/user-guide.md`
    // tells the player to check it before typing a password. A modal window
    // would make that anti-phishing affordance invisible in exactly the
    // configuration that ships. The game window is sitting at a login screen,
    // so leaving it interactive costs nothing.
    // Only a real parent may be passed under exactOptionalPropertyTypes; with
    // no game window yet this simply opens a top-level window.
    ...(parent ? { parent } : {}),
    webPreferences: {
      session: signIn,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });
  return { signIn, win };
}

export async function acquireSteamToken(
  config: SteamOAuthConfig,
  options: SteamAcquireOptions = {},
): Promise<SteamAcquireResult> {
  const record = options.record ?? ((): void => undefined);
  const state = newState();

  let created: { signIn: Session; win: BrowserWindow };
  try {
    created = createSignInWindow(config, options.parent, record);
  } catch {
    // A parent window destroyed mid-request is the realistic case — during app
    // quit, or a fast close between the click and this call. Report it as a
    // failed sign-in rather than rejecting, because every caller from here to
    // the client's login screen is written against "this never throws".
    record({ k: "settled", outcome: "failed" });
    return { ok: false, reason: "failed" };
  }
  const { signIn, win } = created;

  return await new Promise<SteamAcquireResult>((resolve) => {
    let settled = false;

    /**
     * Tear the partition down and only then answer. Clearing before resolving
     * is what makes R19 an observable guarantee rather than a hope: the caller
     * cannot see a token until every cookie, cache entry, and storage record
     * from this attempt is gone.
     */
    const finish = (result: SteamAcquireResult): void => {
      if (settled) return;
      settled = true;
      record({ k: "settled", outcome: result.ok ? "success" : result.reason });
      void signIn
        .clearStorageData()
        .then(() => signIn.clearCache())
        .catch(() => undefined)
        .finally(() => {
          if (!win.isDestroyed()) win.destroy();
          resolve(result);
        });
    };

    win.webContents.setWindowOpenHandler(() => {
      record({ k: "blocked", what: "popup" });
      return { action: "deny" };
    });
    win.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
      record({ k: "blocked", what: "webview" });
    });

    const guard = (event: Electron.Event, url: string): void => {
      if (isRedirectTarget(config, url)) {
        // Read the token out of the redirect and stop it here. The return URL
        // is never fetched, which is why it needs no allowlist entry.
        event.preventDefault();
        const parsed = parseRedirect(url, state);
        finish(
          parsed.ok
            ? { ok: true, token: parsed.token }
            : { ok: false, reason: parsed.reason },
        );
        return;
      }
      if (!isAllowedOrigin(config, url)) {
        event.preventDefault();
        record({ k: "blocked", what: "navigation" });
      }
    };
    win.webContents.on("will-navigate", guard);
    win.webContents.on("will-redirect", guard);

    // R18: the live origin sits in the title bar, which the loaded page can
    // neither draw over nor rename, so the player can confirm where they are.
    const showOrigin = (): void => {
      if (win.isDestroyed()) return;
      let origin = "";
      try {
        origin = new URL(win.webContents.getURL()).origin;
      } catch {
        // No URL yet, before the first navigation commits.
      }
      win.setTitle(origin ? `Steam sign-in — ${origin}` : "Steam sign-in");
    };
    win.webContents.on("did-navigate", showOrigin);
    win.webContents.on("did-navigate-in-page", showOrigin);
    win.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      showOrigin();
    });

    // Shown before the navigation, not on `ready-to-show`. A load that stalls
    // forever never fires that event, which would leave an invisible window the
    // player cannot close while the client waits on a credential — the hang R2
    // exists to prevent. A brief empty window is the cost of always being
    // cancellable.
    win.show();
    // The player gave up. Resolving here is what keeps the client's credential
    // request from hanging forever (R2).
    win.on("closed", () => finish({ ok: false, reason: "cancelled" }));
    // And the page died on its own. Steam's login page is external content that
    // pulls assets from several hosts, so a renderer crash is a real failure
    // mode — and without this the window sits there dead while the client waits
    // on a credential that can no longer arrive. The game window
    // (`src/main/window.ts`) and `src/main/renderer-commands.ts` both listen for
    // exactly this so pending work settles instead of waiting on a dead
    // renderer; this is the same rule for the same reason.
    win.webContents.on("render-process-gone", () =>
      finish({ ok: false, reason: "failed" }),
    );

    record({ k: "opened" });
    void win
      .loadURL(buildAuthUrl(config, state))
      .catch(() => finish({ ok: false, reason: "failed" }));
  });
}
