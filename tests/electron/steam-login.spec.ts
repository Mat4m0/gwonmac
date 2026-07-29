// The credential seam, driven the way the game client drives it: through the
// real `Module.login` / `Module.nativeAccount` objects, the frozen bridge, the
// real IPC handlers, and the real encrypted store. The OS encryption provider
// is replaced at its existing composition seam with deterministic ciphertext;
// provider qualification has its own platform tests.
//
// Interactive requests replace the production acquirer at the composition
// boundary with a local OAuth fixture. The renderer, frozen preload bridge,
// validated IPC handler, coordinator, encrypted store, and BrowserWindow remain
// the real implementations, and the suite never reaches Steam production.
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeOffline,
  expect,
  launchOffline,
  launchOfflineAt,
  root,
  test,
  type OfflineFixture,
} from "./fixtures.mts";
import { extractZipNatively } from "../helpers/native-zip.js";

const SESSION_MODULE = path.join(root, "build/main/core/steam-session.js");
const IPC_MODULE = path.join(root, "build/main/ipc.js");
const ACQUIRE_MODULE = path.join(root, "build/main/steam-acquire.js");
const CONTRACTS_MODULE = path.join(root, "build/shared/contracts.js");
const RETURN_URL = "https://www.guildwars.test/app/live/auth";

/** A fake token: 32 hex characters that were typed here, not issued. */
const TOKEN = "0123456789abcdef0123456789abcdef";
const FAR_FUTURE = 4_000_000_000_000;

interface StoredRecord {
  token: string;
  expiry: number | null;
}

interface IpcOAuthFixture {
  readonly config: {
    clientId: string;
    authorizationBaseUrl: string;
    redirectUrl: string;
    responseType: "token";
    allowedHostSuffixes: readonly string[];
  };
  readonly hits: number;
  release(): void;
  close(): Promise<void>;
}

async function startIpcOAuthFixture(): Promise<IpcOAuthFixture> {
  let hits = 0;
  let pending: { response: ServerResponse; state: string } | null = null;
  let released = false;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/authorize") {
      response.writeHead(404).end();
      return;
    }
    hits += 1;
    pending = { response, state: url.searchParams.get("state") ?? "" };
    if (released) {
      response.writeHead(302, {
        location: `${RETURN_URL}#access_token=${TOKEN}&state=${encodeURIComponent(pending.state)}`,
      });
      response.end();
      pending = null;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    config: {
      clientId: "FIXTURE-CLIENT",
      authorizationBaseUrl: `http://127.0.0.1:${port}/authorize`,
      redirectUrl: RETURN_URL,
      responseType: "token",
      allowedHostSuffixes: [],
    },
    get hits() {
      return hits;
    },
    release() {
      released = true;
      if (!pending) return;
      pending.response.writeHead(302, {
        location:
          `${RETURN_URL}#access_token=${TOKEN}` +
          `&state=${encodeURIComponent(pending.state)}`,
      });
      pending.response.end();
      pending = null;
    },
    close: () =>
      new Promise<void>((resolve) => {
        pending?.response.destroy();
        server.close(() => resolve());
      }),
  };
}

async function installFixtureAcquirer(
  app: OfflineFixture["app"],
  config?: IpcOAuthFixture["config"],
): Promise<void> {
  await app.evaluate(async ({ app, BrowserWindow, ipcMain }, arg) => {
    const { createRequire } = process.getBuiltinModule("module");
    const fs = process.getBuiltinModule("fs");
    const nodePath = process.getBuiltinModule("path");
    const load = createRequire(arg.ipcModule);
    const { registerSteamIpcHandlers } = load(arg.ipcModule) as {
      registerSteamIpcHandlers(context: unknown, provider: unknown): void;
    };
    const { acquireSteamToken } = load(arg.acquireModule) as {
      acquireSteamToken(
        config: unknown,
        options: unknown,
      ): Promise<unknown>;
    };
    const { IPC } = load(arg.contractsModule) as {
      IPC: {
        steamToken: string;
        steamStore: string;
        steamClear: string;
      };
    };
    for (const channel of [IPC.steamToken, IPC.steamStore, IPC.steamClear]) {
      ipcMain.removeHandler(channel);
    }
    const profilesRoot = nodePath.join(app.getPath("userData"), "profiles");
    const profileId = fs.readdirSync(profilesRoot).find(
      (name) => /^[0-9a-f]{32}$/u.test(name),
    );
    if (!profileId) throw new Error("expected the bootstrapped fixture profile");
    const profile = {
      id: profileId,
      label: "Steam fixture",
      paths: {
        steamSession: nodePath.join(profilesRoot, profileId, "steam-session.bin"),
      },
    };
    const contextForWindow = (win: unknown) => ({
      kind: "game",
      window: win,
      profileId,
    });
    const testProvider = {
      protection: "os-safe-storage-v1",
      acceptsLegacyRawCiphertext: false,
      available: async () => true,
      encrypt: async (plaintext: string) =>
        Buffer.from(Buffer.from(plaintext, "utf8").reverse()),
      decrypt: async (ciphertext: Buffer) => ({
        plaintext: Buffer.from(Buffer.from(ciphertext).reverse()).toString("utf8"),
        shouldReEncrypt: false,
      }),
    };
    (
      globalThis as typeof globalThis & {
        __gwSteamTestProvider?: unknown;
      }
    ).__gwSteamTestProvider = testProvider;
    registerSteamIpcHandlers({
      windows: {
        contextFor: (contents: unknown) => {
          const win = BrowserWindow.fromWebContents(contents as never);
          return win ? contextForWindow(win) : null;
        },
        contextForWindow,
      },
      getProfile: async () => profile,
      acquireSteamToken: (parent: unknown, record: (event: unknown) => void) => {
        if (!arg.config) {
          throw new Error("unexpected interactive Steam acquisition");
        }
        return acquireSteamToken(arg.config, { parent, record });
      },
    }, testProvider);
  }, {
    ipcModule: IPC_MODULE,
    acquireModule: ACQUIRE_MODULE,
    contractsModule: CONTRACTS_MODULE,
    config,
  });
}

async function launchSteamFixture(prefix: string): Promise<OfflineFixture> {
  const fixture = await launchOffline(prefix);
  await installFixtureAcquirer(fixture.app);
  return fixture;
}

async function launchSteamFixtureAt(userData: string): Promise<OfflineFixture> {
  const fixture = await launchOfflineAt(userData);
  await installFixtureAcquirer(fixture.app);
  return fixture;
}

/**
 * Write the real encrypted store through the real class before the client asks
 * for anything. The injected provider is deterministic but still produces
 * ciphertext; OS-provider qualification belongs to the platform credential
 * tests rather than to every Steam coordinator branch.
 *
 * This is how a test seeds a token now that no environment variable can. It
 * lives entirely inside the test -- production source carries no seeding path
 * -- and it exercises the actual persistence rather than standing in for it.
 */
async function seedStore(
  app: OfflineFixture["app"],
  record: StoredRecord,
): Promise<void> {
  await app.evaluate(async ({ app }, arg) => {
    const { createRequire } = process.getBuiltinModule("module");
    const fs = process.getBuiltinModule("fs");
    const nodePath = process.getBuiltinModule("path");
    const load = createRequire(arg.sessionModule);
    const { SteamSessionStore } = load(arg.sessionModule) as {
      SteamSessionStore: new (path: string, storage: unknown) => {
        save(value: unknown): Promise<void>;
      };
    };
    const provider = (
      globalThis as typeof globalThis & {
        __gwSteamTestProvider?: unknown;
      }
    ).__gwSteamTestProvider;
    if (!provider) throw new Error("Steam test provider was not installed");
    const profilesRoot = nodePath.join(app.getPath("userData"), "profiles");
    const profileId = fs.readdirSync(profilesRoot).find(
      (name) => /^[0-9a-f]{32}$/u.test(name),
    );
    if (!profileId) throw new Error("expected the bootstrapped fixture profile");
    const steamSession = nodePath.join(profilesRoot, profileId, "steam-session.bin");
    await new SteamSessionStore(
      steamSession,
      provider,
    ).save(
      arg.record,
    );
  }, { sessionModule: SESSION_MODULE, record });
}

async function readStore(
  app: OfflineFixture["app"],
): Promise<StoredRecord | null> {
  return (await app.evaluate(async ({ app }, arg) => {
    const { createRequire } = process.getBuiltinModule("module");
    const fs = process.getBuiltinModule("fs");
    const nodePath = process.getBuiltinModule("path");
    const load = createRequire(arg.sessionModule);
    const { SteamSessionStore } = load(arg.sessionModule) as {
      SteamSessionStore: new (path: string, storage: unknown) => {
        load(): Promise<unknown>;
      };
    };
    const provider = (
      globalThis as typeof globalThis & {
        __gwSteamTestProvider?: unknown;
      }
    ).__gwSteamTestProvider;
    if (!provider) throw new Error("Steam test provider was not installed");
    const profilesRoot = nodePath.join(app.getPath("userData"), "profiles");
    const profileId = fs.readdirSync(profilesRoot).find(
      (name) => /^[0-9a-f]{32}$/u.test(name),
    );
    if (!profileId) throw new Error("expected the bootstrapped fixture profile");
    return new SteamSessionStore(
      nodePath.join(profilesRoot, profileId, "steam-session.bin"),
      provider,
    ).load();
  }, { sessionModule: SESSION_MODULE })) as
    | StoredRecord
    | null;
}

type SeamResult =
  | { settled: "resolved"; value: unknown }
  | { settled: "rejected" };

/** Ask for a credential the way the client's glue does. */
async function getAuthToken(
  fixture: OfflineFixture,
  provider: string,
  silent: boolean,
): Promise<SeamResult> {
  return fixture.page.evaluate(
    async ({ provider: name, silent: quiet }): Promise<SeamResult> => {
      const login = (
        globalThis as unknown as {
          Module: {
            login: {
              getAuthToken(name: string, options: { silent: boolean }): Promise<unknown>;
            };
          };
        }
      ).Module.login;
      try {
        return { settled: "resolved", value: await login.getAuthToken(name, { silent: quiet }) };
      } catch {
        // The reason is deliberately not carried out: the client only needs to
        // know it was refused, and it rebuilds its own login screen from that.
        return { settled: "rejected" };
      }
    },
    { provider, silent },
  );
}

async function windowCount(app: OfflineFixture["app"]): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

test.describe("the Steam credential seam", () => {
  let fixture: OfflineFixture;
  let oauth: IpcOAuthFixture | undefined;

  test.afterEach(async () => {
    if (oauth) await oauth.close();
  });

  test("advertises only Steam and keeps the silent launch probe invisible", async () => {
    // The client renders its Steam button beside the
    // unchanged ArenaNet email/password form.
    fixture = await launchSteamFixture("gw-steam-providers-");
    const answers = await fixture.page.evaluate(() => {
      const login = (
        globalThis as unknown as {
          Module: { login: { hasProvider(name: string): boolean } };
        }
      ).Module.login;
      return {
        steam: login.hasProvider("Steam"),
        apple: login.hasProvider("Apple"),
        google: login.hasProvider("Google"),
        facebook: login.hasProvider("Facebook"),
        nonsense: login.hasProvider("NotAProvider"),
      };
    });
    expect(answers).toEqual({
      steam: true,
      apple: false,
      google: false,
      facebook: false,
      nonsense: false,
    });
    const before = await windowCount(fixture.app);

    const result = await getAuthToken(fixture, "Steam", true);

    expect(result).toEqual({ settled: "rejected" });
    expect(await getAuthToken(fixture, "Apple", true)).toEqual({
      settled: "rejected",
    });
    expect(await windowCount(fixture.app)).toBe(before);
    expect(await readStore(fixture.app)).toBe(null);
  });

  test("drives an explicit request through the real bridge and IPC seam", async () => {
    oauth = await startIpcOAuthFixture();
    fixture = await launchSteamFixture("gw-steam-ipc-explicit-");
    await installFixtureAcquirer(fixture.app, oauth.config);

    const requested = getAuthToken(fixture, "Steam", false);
    await expect.poll(() => oauth?.hits ?? 0).toBe(1);
    oauth.release();

    expect(await requested).toEqual({
      settled: "resolved",
      value: { userId: "1", authCode: TOKEN, refreshToken: "" },
    });
    expect(await readStore(fixture.app)).toEqual({
      token: TOKEN,
      expiry: expect.any(Number),
    });
  });

  test("replays the stored token across a relaunch", async () => {
    // The token survives the process, which is the whole
    // point of persisting it.
    fixture = await launchSteamFixture("gw-steam-relaunch-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });
    const userData = fixture.userData;
    await closeOffline(fixture, { removeUserData: false });

    fixture = await launchSteamFixtureAt(userData);
    expect(await getAuthToken(fixture, "Steam", true)).toEqual({
      settled: "resolved",
      value: { userId: "1", authCode: TOKEN, refreshToken: "" },
    });
  });

  test("exports diagnostics carrying outcomes and neither the token nor its expiry", async () => {
    // The claim is about the exported bytes, not about a
    // verdict the exporter wrote about itself: drive the whole seam, export,
    // unzip, and read every file.
    const DIAGNOSTIC_EXPIRY = 4_123_456_789_123;
    fixture = await launchSteamFixture("gw-steam-diagnostics-");
    await seedStore(fixture.app, { token: TOKEN, expiry: DIAGNOSTIC_EXPIRY });

    // Every Steam event this feature can record, in one session.
    await getAuthToken(fixture, "Steam", true);
    await fixture.page.evaluate(
      async ({ token, expiry }) => {
        const account = (
          globalThis as unknown as {
            Module: {
              nativeAccount: {
                storeAccountData(token: string, expiry: Date): Promise<void>;
                clearAccountData(): Promise<void>;
              };
            };
          }
        ).Module.nativeAccount;
        await account.storeAccountData(token, new Date(expiry));
        await account.clearAccountData();
      },
      { token: TOKEN, expiry: DIAGNOSTIC_EXPIRY },
    );
    await getAuthToken(fixture, "Steam", true);

    const diagnosticRoot = await mkdtemp(path.join(tmpdir(), "gwdiag-steam-"));
    const target = path.join(diagnosticRoot, "capture.gwdiag");
    await fixture.app.evaluate(
      async ({ app }, args) => {
        const { createRequire } = process.getBuiltinModule("module");
        const load = createRequire(args.modulePath);
        const diagnostics = load(args.modulePath) as {
          exportDiagnosticsZip(
            target: string,
            meta: Record<string, unknown>,
          ): Promise<void>;
        };
        await diagnostics.exportDiagnosticsZip(args.target, {
          appVersion: app.getVersion(),
          electronVersions: { electron: process.versions.electron },
          settings: {
            renderScale: 1,
            nativeCursor: false,
            touchMode: "dbltap",
            showDiagnostics: false,
            dataStrategy: "quick",
          },
        });
      },
      { modulePath: path.join(root, "build/main/diagnostics.js"), target },
    );

    const extracted = path.join(diagnosticRoot, "extracted");
    await extractZipNatively(target, extracted);

    let everything = "";
    for (const name of await readdir(extracted)) {
      const file = path.join(extracted, name);
      if (!(await stat(file)).isFile()) continue;
      const body = await readFile(file, "latin1");
      everything += body;
      expect(body, `${name} leaked the token`).not.toContain(TOKEN);
      expect(body, `${name} leaked the expiry`).not.toContain(
        String(DIAGNOSTIC_EXPIRY),
      );
    }

    // The outcomes did survive — an export that simply recorded nothing would
    // pass the two assertions above for the wrong reason.
    expect(everything).toContain("steam.tokenRequested");
    expect(everything).toContain("steam.storeback");
    expect(everything).toContain("steam.tokenCleared");

    // Every app-authored record was certified against the closed schema, which
    // is what makes "outcomes only" a property of the schema rather than of the
    // events this test happened to produce.
    const manifest = JSON.parse(
      await readFile(path.join(extracted, "manifest.json"), "utf8"),
    ) as { redaction: { records: number; schemaChecked: number } };
    expect(manifest.redaction.records).toBeGreaterThan(0);
    expect(manifest.redaction.schemaChecked).toBe(manifest.redaction.records);
  });
});
