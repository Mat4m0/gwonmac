import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type {
  BrowserWindow,
  Session,
  WebContents,
} from "electron";
import { installGameSession } from "../../src/main/game-session.js";
import type { WindowRegistry } from "../../src/main/window-registry.js";

interface InstalledHandlers {
  permissionCheck?: (
    contents: WebContents | null,
    permission: string,
    origin: string,
    details: { isMainFrame: boolean },
  ) => boolean;
  permissionRequest?: (
    contents: WebContents,
    permission: string,
    callback: (allowed: boolean) => void,
    details: { isMainFrame: boolean },
  ) => void;
  protocol?: (request: Request) => Promise<Response>;
  request?: (
    details: { resourceType: string; url: string },
    callback: (response: { cancel?: boolean }) => void,
  ) => void;
  userAgent?: string;
}

function fixture() {
  const events = new EventEmitter();
  const handlers: InstalledHandlers = {};
  const session = Object.assign(events, {
    protocol: {
      handle(
        scheme: string,
        handler: (request: Request) => Promise<Response>,
      ) {
        assert.equal(scheme, "gw");
        handlers.protocol = handler;
      },
    },
    webRequest: {
      onBeforeRequest(
        handler: NonNullable<InstalledHandlers["request"]>,
      ) {
        handlers.request = handler;
      },
    },
    setUserAgent(value: string) {
      handlers.userAgent = value;
    },
    setPermissionRequestHandler(
      handler: NonNullable<InstalledHandlers["permissionRequest"]>,
    ) {
      handlers.permissionRequest = handler;
    },
    setPermissionCheckHandler(
      handler: NonNullable<InstalledHandlers["permissionCheck"]>,
    ) {
      handlers.permissionCheck = handler;
    },
  }) as unknown as Session;
  let url = "gw://app/";
  const contents = {
    id: 7,
    getURL: () => url,
  } as WebContents;
  const window = { webContents: contents } as BrowserWindow;
  let owned = true;
  const windows = {
    contextFor: (candidate: WebContents) =>
      owned && candidate === contents
        ? { kind: "game", window, profileId: null, slot: 1 }
        : null,
  } as WindowRegistry;
  return {
    contents,
    events,
    handlers,
    session,
    setOwned(value: boolean) {
      owned = value;
    },
    setUrl(value: string) {
      url = value;
    },
    windows,
  };
}

test("the game session installs its protocol and refuses repeat installation", () => {
  const target = fixture();
  installGameSession(target.session, target.windows, async () => new Response());
  assert.equal(typeof target.handlers.protocol, "function");
  assert.equal(
    target.handlers.userAgent,
    "gwonmac (Guild Wars interoperability client)",
  );
  assert.throws(
    () => installGameSession(
      target.session,
      target.windows,
      async () => new Response(),
    ),
    /already installed/u,
  );
});

test("pointer lock belongs to the exact registered game main frame", () => {
  const target = fixture();
  installGameSession(target.session, target.windows, async () => new Response());
  const check = target.handlers.permissionCheck!;
  assert.equal(check(target.contents, "pointerLock", "gw://app/", {
    isMainFrame: true,
  }), true);
  assert.equal(check(target.contents, "media", "gw://app/", {
    isMainFrame: true,
  }), false);
  assert.equal(check(target.contents, "pointerLock", "gw://app/", {
    isMainFrame: false,
  }), false);
  assert.equal(check({ id: 7, getURL: () => "gw://app/" } as WebContents,
    "pointerLock", "gw://app/", { isMainFrame: true }), false);

  target.setOwned(false);
  assert.equal(check(target.contents, "pointerLock", "gw://app/", {
    isMainFrame: true,
  }), false);
  target.setOwned(true);
  target.setUrl("https://example.invalid/");
  assert.equal(check(target.contents, "pointerLock", "gw://app/", {
    isMainFrame: true,
  }), false);
});

test("permission requests and downloads fail closed", () => {
  const target = fixture();
  installGameSession(target.session, target.windows, async () => new Response());
  let allowed: boolean | null = null;
  target.handlers.permissionRequest!(
    target.contents,
    "notifications",
    (value) => {
      allowed = value;
    },
    { isMainFrame: true },
  );
  assert.equal(allowed, false);

  let prevented = false;
  target.events.emit("will-download", {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
});

test("session navigation permits only the canonical game main frame", () => {
  const target = fixture();
  installGameSession(target.session, target.windows, async () => new Response());
  const request = target.handlers.request!;
  const cancelled: boolean[] = [];
  const check = (resourceType: string, url: string) => {
    request({ resourceType, url }, (response) => {
      cancelled.push(response.cancel ?? false);
    });
  };

  check("mainFrame", "gw://app/");
  check("mainFrame", "https://example.invalid/");
  check("xhr", "https://example.invalid/");
  assert.deepEqual(cancelled, [false, true, false]);
});
