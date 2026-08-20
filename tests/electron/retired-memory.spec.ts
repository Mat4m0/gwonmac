import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeOffline,
  launchOfflineAt,
  type OfflineFixture,
} from "./fixtures.mjs";
import {
  seedCachedClient,
  TEST_CLIENT_GLUE,
  TEST_CLIENT_SHA256,
} from "../helpers/cached-client.js";

test("retires an existing 4 GB opt-in before the client starts", async () => {
  test.setTimeout(60_000);
  let relaunched: OfflineFixture | null = null;
  let fixture: OfflineFixture | null = null;
  try {
    const userData = await mkdtemp(path.join(tmpdir(), "gw-retired-memory-e2e-"));
    await seedCachedClient({
      artifacts: path.join(userData, "game", "artifacts"),
      userData,
    }, {
      beforeSeal: async () => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({
            formatVersion: 1,
            autoCheckUpdates: false,
            dataStrategy: "quick",
            extendedMemoryEnabled: true,
            unknownField: { preserved: true },
          }),
        );
        await mkdir(path.join(userData, "game", "extended-memory"));
        await writeFile(
          path.join(userData, "game", "extended-memory", "derived.wasm"),
          "retired",
        );
      },
    });
    fixture = await launchOfflineAt(userData);
    const settings = JSON.parse(await readFile(
      path.join(fixture.userData, "settings.json"),
      "utf8",
    ));
    expect(settings.extendedMemoryEnabled).toBeUndefined();
    expect(settings.unknownField).toEqual({ preserved: true });
    await expect(stat(path.join(fixture.userData, "game", "extended-memory")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fixture.page.locator('input[name="extendedMemoryEnabled"]'))
      .toHaveCount(0);
    await expect.poll(() => fixture!.page.evaluate(async () =>
      Object.hasOwn(await window.gwNative.client.session(), "extendedMemory"),
    )).toBe(false);
    const served = await fixture.page.evaluate(async () => {
      const [js, wasm] = await Promise.all([
        fetch("gw://app/Gw.jspi.js").then((response) => response.text()),
        fetch("gw://app/Gw.jspi.wasm").then((response) => response.arrayBuffer()),
      ]);
      const digest = await crypto.subtle.digest("SHA-256", wasm);
      return {
        js,
        wasmSha256: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      };
    });
    expect(served).toEqual({
      js: TEST_CLIENT_GLUE,
      wasmSha256: TEST_CLIENT_SHA256,
    });

    await fixture.app.close();
    relaunched = await launchOfflineAt(fixture.userData);
  } finally {
    if (relaunched) await closeOffline(relaunched);
    else if (fixture) await closeOffline(fixture);
  }
});
