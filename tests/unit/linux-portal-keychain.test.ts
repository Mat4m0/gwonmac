import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LinuxPortalKeychain } from "../../src/main/linux-portal-keychain.ts";
import { multiSecretSlot } from "../../src/main/core/native-keychain.ts";
import { parseProfileId } from "../../src/shared/multiple-accounts.ts";

const profile = parseProfileId("2d31e565-9fc8-4dde-9fd4-9d644f8283ae");
const otherProfile = parseProfileId("c1353d4b-fb98-4de4-8798-7133050fe3d5");
const firstSlot = multiSecretSlot(profile, "arenaNetCredentials");
const secondSlot = multiSecretSlot(otherProfile, "arenaNetCredentials");

async function fixture(secret: string): Promise<{
  readonly root: string;
  readonly keychain: LinuxPortalKeychain;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gwonmac-linux-secrets-"));
  return {
    root,
    keychain: new LinuxPortalKeychain({
      identity: "io.github.mat4m0.gwonmac",
      root,
      provideSecret: async () => ({
        token: "token",
        secret: Buffer.from(secret.repeat(4), "utf8"),
      }),
    }),
  };
}

describe("Linux Secret portal keychain", () => {
  it("encrypts profile slots independently with owner-only files", async () => {
    const { root, keychain } = await fixture("master-secret-value");
    await keychain.save(firstSlot, Buffer.from("first-password"));
    await keychain.save(secondSlot, Buffer.from("second-password"));

    assert.equal((await keychain.load(firstSlot))?.toString(), "first-password");
    assert.equal((await keychain.load(secondSlot))?.toString(), "second-password");
    const document = await readFile(path.join(root, `${firstSlot}.secret`));
    assert.equal(document.includes(Buffer.from("first-password")), false);
    assert.equal((await stat(path.join(root, `${firstSlot}.secret`))).mode & 0o777, 0o600);

    await keychain.clear(firstSlot);
    assert.equal(await keychain.load(firstSlot), null);
    assert.equal((await keychain.load(secondSlot))?.toString(), "second-password");
  });

  it("fails closed when a different portal secret opens the document", async () => {
    const { root, keychain } = await fixture("first-master-secret");
    await keychain.save(firstSlot, Buffer.from("saved-password"));
    const replacement = new LinuxPortalKeychain({
      identity: "io.github.mat4m0.gwonmac",
      root,
      provideSecret: async () => ({
        token: "replacement",
        secret: Buffer.from("different-master-secret".repeat(4), "utf8"),
      }),
    });

    await assert.rejects(
      () => replacement.load(firstSlot),
      /could not be decrypted/,
    );
  });

  it("binds ciphertext to the distribution identity", async () => {
    const { root, keychain } = await fixture("shared-master-secret");
    await keychain.save(firstSlot, Buffer.from("saved-password"));
    const foreign = new LinuxPortalKeychain({
      identity: "io.github.attacker.gwonmac",
      root,
      provideSecret: async () => ({
        token: "token",
        secret: Buffer.from("shared-master-secret".repeat(4), "utf8"),
      }),
    });
    await assert.rejects(() => foreign.load(firstSlot), /could not be decrypted/);
  });
});
