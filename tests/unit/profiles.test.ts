import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  generateProfileId,
  normalizeProfileLabel,
  parseProfileId,
  profileLabelKey,
  profilePaths,
  ProfileStore,
  type ProfileId,
} from "../../src/main/core/profiles.js";

const ID_A = "00112233445566778899aabbccddeeff" as ProfileId;
const ID_B = "ffeeddccbbaa99887766554433221100" as ProfileId;

async function tempProfiles(): Promise<{
  root: string;
  store: ProfileStore;
}> {
  const userData = await mkdtemp(path.join(os.tmpdir(), "gw-profiles-"));
  const root = path.join(userData, "profiles");
  return { root, store: new ProfileStore(root) };
}

describe("profile identity and paths", () => {
  it("generates 128-bit lowercase opaque IDs", () => {
    const first = generateProfileId();
    const second = generateProfileId();
    assert.match(first, /^[0-9a-f]{32}$/u);
    assert.notEqual(first, second);
  });

  it("rejects traversal, separators, absolute paths, devices, and variants", () => {
    for (const value of [
      "",
      ".",
      "..",
      "../profile",
      "a/b",
      "a\\b",
      "/absolute",
      "C:\\absolute",
      "con",
      "nul",
      "a".repeat(31),
      "A".repeat(32),
      `${"a".repeat(31)}.`,
      `${"a".repeat(31)} `,
      `a\0${"b".repeat(30)}`,
    ]) {
      assert.throws(() => parseProfileId(value), /invalid profile ID/u);
    }
  });

  it("constructs only contained profile-owned paths", () => {
    const root = path.resolve("/profiles");
    const paths = profilePaths(root, ID_A);
    for (const target of Object.values(paths)) {
      assert.equal(
        target === paths.root || target.startsWith(`${paths.root}${path.sep}`),
        true,
      );
      assert.notEqual(target, root);
    }
  });
});

describe("profile labels", () => {
  it("trims and normalizes NFC with a fixed case-folding key", () => {
    assert.equal(normalizeProfileLabel("  Cafe\u0301  "), "Café");
    assert.equal(profileLabelKey("ALPHA"), "alpha");
  });

  it("rejects empty, long, control, and bidi-control labels", () => {
    for (const value of [
      "",
      " ".repeat(4),
      "x".repeat(41),
      "line\nbreak",
      "left\u202eright",
      "isolate\u2066text",
    ]) {
      assert.throws(() => normalizeProfileLabel(value), /invalid profile label/u);
    }
  });

  it("counts Unicode scalars and treats HTML-like text as inert display data", () => {
    assert.equal(Array.from(normalizeProfileLabel("😀".repeat(40))).length, 40);
    assert.equal(
      normalizeProfileLabel("<img src=x onerror=alert(1)>"),
      "<img src=x onerror=alert(1)>",
    );
  });
});

describe("directory-backed ProfileStore", () => {
  it("creates closed documents atomically and scans in canonical label order", async () => {
    const { root } = await tempProfiles();
    const ids = [ID_A, ID_B];
    const store = new ProfileStore(root, () => ids.shift()!);
    const zulu = await store.create("Zulu");
    const alpha = await store.create(" alpha ");

    assert.deepEqual(
      (await store.scan()).profiles.map((profile) => profile.label),
      ["alpha", "Zulu"],
    );
    assert.deepEqual(
      JSON.parse(await readFile(zulu.paths.document, "utf8")),
      { formatVersion: 1, label: "Zulu" },
    );
    assert.equal((await stat(zulu.paths.browser)).isDirectory(), true);
    assert.equal(alpha.id, ID_B);
    if (process.platform !== "win32") {
      assert.equal((await stat(zulu.paths.document)).mode & 0o777, 0o600);
    }
  });

  it("serializes create/rename and refuses duplicate canonical labels", async () => {
    const { root } = await tempProfiles();
    const ids = [ID_A, ID_B];
    const store = new ProfileStore(root, () => ids.shift()!);
    const results = await Promise.allSettled([
      store.create("Alpha"),
      store.create(" alpha "),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);

    const [profile] = (await store.scan()).profiles;
    assert.ok(profile);
    await store.rename(profile.id, "Bravo");
    assert.equal((await store.scan()).profiles[0]?.label, "Bravo");
  });

  it("isolates corrupt profiles instead of blocking valid profiles", async () => {
    const { root } = await tempProfiles();
    const store = new ProfileStore(root, () => ID_A);
    await store.create("Valid");
    const corrupt = profilePaths(root, ID_B);
    await mkdir(corrupt.root, { recursive: true });
    await writeFile(corrupt.document, JSON.stringify({
      formatVersion: 1,
      label: "Bad",
      extra: true,
    }));

    const scan = await store.scan();
    assert.equal(scan.invalidCount, 1);
    assert.deepEqual(scan.profiles.map((profile) => profile.label), ["Valid"]);
  });

  it("forgets only the selected credential document", async () => {
    const { root } = await tempProfiles();
    const store = new ProfileStore(root, () => ID_A);
    const profile = await store.create("Alpha");
    const globalSentinel = path.join(path.dirname(root), "settings.json");
    await writeFile(profile.paths.credentials, "ciphertext");
    await writeFile(globalSentinel, "global");

    await store.forgetSavedLogin(profile.id);
    await assert.rejects(stat(profile.paths.credentials), { code: "ENOENT" });
    assert.equal(await readFile(globalSentinel, "utf8"), "global");
    assert.equal((await stat(profile.paths.root)).isDirectory(), true);
  });

  it("requests game-storage reset only inside the selected profile", async () => {
    const { root } = await tempProfiles();
    const store = new ProfileStore(root, () => ID_A);
    const profile = await store.create("Alpha");
    const globalSentinel = path.join(path.dirname(root), "settings.json");
    await writeFile(globalSentinel, "global");

    await store.requestGameStorageReset(profile.id);
    assert.equal((await stat(profile.paths.gameStorageClearRequest)).size, 0);
    assert.equal(await readFile(globalSentinel, "utf8"), "global");
  });

  it("defers trash, refuses running profiles, and preserves failed trash", async () => {
    const { root } = await tempProfiles();
    const store = new ProfileStore(root, () => ID_A);
    const profile = await store.create("Alpha");
    await assert.rejects(
      store.requestTrash(profile.id, () => true),
      /running profile/u,
    );
    await store.requestTrash(profile.id, () => false);
    assert.equal((await stat(profile.paths.trashOnStart)).size, 0);

    assert.deepEqual(
      await store.trashMarked(async () => {
        throw new Error("trash unavailable");
      }),
      { trashed: 0, failed: 1 },
    );
    assert.equal((await stat(profile.paths.root)).isDirectory(), true);
    assert.equal((await stat(profile.paths.trashOnStart)).isFile(), true);
  });

  it("honours an exact trash marker even if profile metadata became corrupt", async () => {
    const { root } = await tempProfiles();
    const store = new ProfileStore(root, () => ID_A);
    const profile = await store.create("Alpha");
    await store.requestTrash(profile.id, () => false);
    await writeFile(profile.paths.document, "{broken");
    const trashed: string[] = [];

    assert.deepEqual(
      await store.trashMarked(async (target) => {
        trashed.push(target);
      }),
      { trashed: 1, failed: 0 },
    );
    assert.deepEqual(trashed, [profile.paths.root]);
  });

  it("cleans only recognised create stages and leaves unknown content", async () => {
    const { root, store } = await tempProfiles();
    const stage = path.join(root, `.create-${ID_A}.stage`);
    const unknown = path.join(root, ".create-NOT-A-PROFILE.stage");
    const ordinary = path.join(root, "operator-files");
    await mkdir(stage, { recursive: true });
    await mkdir(unknown, { recursive: true });
    await mkdir(ordinary, { recursive: true });

    assert.equal(await store.cleanupIncompleteStages(), 1);
    await assert.rejects(stat(stage), { code: "ENOENT" });
    assert.equal((await stat(unknown)).isDirectory(), true);
    assert.equal((await stat(ordinary)).isDirectory(), true);
  });
});
