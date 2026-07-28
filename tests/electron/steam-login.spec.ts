// The credential seam, driven the way the game client drives it: through the
// real `Module.login` / `Module.nativeAccount` objects, the real frozen bridge,
// the real IPC handlers, and the real encrypted store. Nothing is stubbed --
// `gwNative.steam` is frozen, so it could not be.
//
// Only the *silent* request is exercised here. A non-silent request is the one
// allowed to open a Steam window, and an offline suite must never reach
// steamcommunity.com; that path is covered by tests/electron/steam-acquire.spec.ts
// against an injected fixture config, and once by hand on a linked account.
import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  closeOffline,
  launchOffline,
  launchOfflineAt,
  root,
  type OfflineFixture,
} from "./fixtures.mts";

const execFileAsync = promisify(execFile);

const SESSION_MODULE = path.join(root, "build/main/core/steam-session.js");
const PATHS_MODULE = path.join(root, "build/main/paths.js");

/** A fake token: 32 hex characters that were typed here, not issued. */
const TOKEN = "0123456789abcdef0123456789abcdef";
const OTHER_TOKEN = "fedcba9876543210fedcba9876543210";
const FAR_FUTURE = 4_000_000_000_000;

interface StoredRecord {
  token: string;
  expiry: number | null;
}

/**
 * Write the real encrypted store, through the real class and the real
 * `safeStorage`, before the client asks for anything.
 *
 * This is how a test seeds a token now that no environment variable can. It
 * lives entirely inside the test -- production source carries no seeding path
 * -- and it exercises the actual persistence rather than standing in for it.
 */
async function seedStore(
  app: OfflineFixture["app"],
  record: StoredRecord,
): Promise<void> {
  await app.evaluate(async ({ safeStorage }, arg) => {
    const { createRequire } = process.getBuiltinModule("module");
    const load = createRequire(arg.sessionModule);
    const { SteamSessionStore } = load(arg.sessionModule) as {
      SteamSessionStore: new (path: string, storage: unknown) => {
        save(value: unknown): Promise<void>;
      };
    };
    const { gamePaths } = load(arg.pathsModule) as {
      gamePaths: () => { steamSession: string };
    };
    await new SteamSessionStore(gamePaths().steamSession, safeStorage).save(
      arg.record,
    );
  }, { sessionModule: SESSION_MODULE, pathsModule: PATHS_MODULE, record });
}

async function readStore(
  app: OfflineFixture["app"],
): Promise<StoredRecord | null> {
  return (await app.evaluate(async ({ safeStorage }, arg) => {
    const { createRequire } = process.getBuiltinModule("module");
    const load = createRequire(arg.sessionModule);
    const { SteamSessionStore } = load(arg.sessionModule) as {
      SteamSessionStore: new (path: string, storage: unknown) => {
        load(): Promise<unknown>;
      };
    };
    const { gamePaths } = load(arg.pathsModule) as {
      gamePaths: () => { steamSession: string };
    };
    return new SteamSessionStore(gamePaths().steamSession, safeStorage).load();
  }, { sessionModule: SESSION_MODULE, pathsModule: PATHS_MODULE })) as
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

  test.afterEach(async () => {
    if (fixture) await closeOffline(fixture);
  });

  test("advertises Steam and nothing else", async () => {
    // Covers AE7 / R1, R11: the client renders its Steam button beside the
    // unchanged ArenaNet email/password form.
    fixture = await launchOffline("gw-steam-providers-");
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
  });

  test("refuses a silent request with no stored token, opening no window", async () => {
    // Covers AE1 / R4. This is the launch-time probe: a player who never signed
    // in with Steam must not be shown a Steam window for it.
    fixture = await launchOffline("gw-steam-none-");
    const before = await windowCount(fixture.app);

    const result = await getAuthToken(fixture, "Steam", true);

    expect(result).toEqual({ settled: "rejected" });
    expect(await windowCount(fixture.app)).toBe(before);
    expect(await readStore(fixture.app)).toBe(null);
  });

  test("reads a request with no options as the silent one", async () => {
    // R4 / AE1 from the other direction. The observed client always passes
    // `{ silent }`, so this is about a build that stops: refusing is recoverable
    // -- email and password still work -- while opening a Steam window nobody
    // asked for is the failure the requirement exists to prevent.
    fixture = await launchOffline("gw-steam-no-options-");
    const before = await windowCount(fixture.app);

    const settled = await fixture.page.evaluate(async () => {
      const login = (
        globalThis as unknown as {
          Module: { login: { getAuthToken(name: string): Promise<unknown> } };
        }
      ).Module.login;
      try {
        await login.getAuthToken("Steam");
        return "resolved";
      } catch {
        return "rejected";
      }
    });

    expect(settled).toBe("rejected");
    expect(await windowCount(fixture.app)).toBe(before);
  });

  test("vends a stored token in the shape the client destructures", async () => {
    // Covers AE5 / R3: `userId` is the client's local profile index, not the
    // SteamID, and `refreshToken` is empty. The client base64-encodes
    // `authCode` into <PasswordToken> for login.xml.
    fixture = await launchOffline("gw-steam-stored-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });

    const result = await getAuthToken(fixture, "Steam", true);

    expect(result).toEqual({
      settled: "resolved",
      value: { userId: "1", authCode: TOKEN, refreshToken: "" },
    });
    expect(await windowCount(fixture.app)).toBe(1);
  });

  test("refuses a provider it does not offer", async () => {
    fixture = await launchOffline("gw-steam-wrong-provider-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });
    expect(await getAuthToken(fixture, "Apple", true)).toEqual({
      settled: "rejected",
    });
  });

  test("replays the stored token across a relaunch", async () => {
    // Covers AE5 end to end: the token survives the process, which is the whole
    // point of persisting it.
    fixture = await launchOffline("gw-steam-relaunch-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });
    const userData = fixture.userData;
    await fixture.app.close();

    fixture = await launchOfflineAt(userData);
    expect(await getAuthToken(fixture, "Steam", true)).toEqual({
      settled: "resolved",
      value: { userId: "1", authCode: TOKEN, refreshToken: "" },
    });
  });

  test("treats an expired stored token as absent", async () => {
    // Covers R8: back to the login screen, not a failed launch.
    fixture = await launchOffline("gw-steam-expired-");
    await seedStore(fixture.app, { token: TOKEN, expiry: 1 });

    expect(await getAuthToken(fixture, "Steam", true)).toEqual({
      settled: "rejected",
    });
    expect(await readStore(fixture.app)).toBe(null);
  });

  test("relays the account storeback as an expiry refresh", async () => {
    // R9 / KTD5: the expiry moves, the token does not, and only for the token
    // already held.
    fixture = await launchOffline("gw-steam-storeback-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });

    await fixture.page.evaluate(
      async ({ token, expiry }) => {
        const account = (
          globalThis as unknown as {
            Module: {
              nativeAccount: {
                storeAccountData(token: string, expiry: Date): Promise<void>;
              };
            };
          }
        ).Module.nativeAccount;
        await account.storeAccountData(token, new Date(expiry));
      },
      { token: TOKEN, expiry: FAR_FUTURE - 5_000 },
    );

    expect(await readStore(fixture.app)).toEqual({
      token: TOKEN,
      expiry: FAR_FUTURE - 5_000,
    });
  });

  test("ignores a storeback carrying something other than the held token", async () => {
    fixture = await launchOffline("gw-steam-storeback-other-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });

    await fixture.page.evaluate(
      async ({ other }) => {
        const account = (
          globalThis as unknown as {
            Module: {
              nativeAccount: {
                storeAccountData(token: string, expiry: Date): Promise<void>;
              };
            };
          }
        ).Module.nativeAccount;
        // The empty string is what this host vends as `refreshToken`, so it is
        // the value most likely to come back.
        await account.storeAccountData("", new Date(1));
        await account.storeAccountData(other, new Date(1));
      },
      { other: OTHER_TOKEN },
    );

    expect(await readStore(fixture.app)).toEqual({
      token: TOKEN,
      expiry: FAR_FUTURE,
    });
  });

  test("relays an unusable expiry as no expiry rather than as a date", async () => {
    fixture = await launchOffline("gw-steam-bad-date-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });

    await fixture.page.evaluate(
      async ({ token }) => {
        const account = (
          globalThis as unknown as {
            Module: {
              nativeAccount: {
                storeAccountData(token: string, expiry: unknown): Promise<void>;
              };
            };
          }
        ).Module.nativeAccount;
        await account.storeAccountData(token, new Date("not a date"));
      },
      { token: TOKEN },
    );

    // `null` is "no expiry known", which R9 treats as a token to be proved by
    // the login exchange -- not as one that expired at the epoch.
    expect(await readStore(fixture.app)).toEqual({ token: TOKEN, expiry: null });
  });

  test("exports diagnostics carrying outcomes and neither the token nor its expiry", async () => {
    // Covers AE8 / R20, R21. The claim is about the exported bytes, not about a
    // verdict the exporter wrote about itself: drive the whole seam, export,
    // unzip, and read every file.
    const DIAGNOSTIC_EXPIRY = 4_123_456_789_123;
    fixture = await launchOffline("gw-steam-diagnostics-");
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
    await execFileAsync("ditto", ["-x", "-k", target, extracted]);

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

  test("forgets the token when the client signs out", async () => {
    // Covers AE9 / R7.
    fixture = await launchOffline("gw-steam-signout-");
    await seedStore(fixture.app, { token: TOKEN, expiry: FAR_FUTURE });

    await fixture.page.evaluate(async () => {
      const account = (
        globalThis as unknown as {
          Module: { nativeAccount: { clearAccountData(): Promise<void> } };
        }
      ).Module.nativeAccount;
      await account.clearAccountData();
    });

    expect(await readStore(fixture.app)).toBe(null);
    expect(await getAuthToken(fixture, "Steam", true)).toEqual({
      settled: "rejected",
    });
  });
});
