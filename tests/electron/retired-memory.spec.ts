import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const hook = fileURLToPath(new URL("./capture-message-box.cjs", import.meta.url));

test("retires an existing 4 GB opt-in before the client starts", async () => {
  test.setTimeout(60_000);
  let relaunched: OfflineFixture | null = null;
  let fixture: OfflineFixture | null = null;
  const environment = (capture: string) => ({
    NODE_OPTIONS: `--require=${hook}`,
    GW_TEST_MESSAGE_BOX_CAPTURE: capture,
  });
  try {
    const userData = await mkdtemp(path.join(tmpdir(), "gw-retired-memory-e2e-"));
    const capture = path.join(userData, "retirement-notices.jsonl");
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
        await mkdir(path.join(userData, "game", "enhancements"));
        await writeFile(
          path.join(userData, "game", "enhancements", "preserved"),
          "sibling",
        );
      },
    });
    fixture = await launchOfflineAt(userData, environment(capture));

    const notice = JSON.parse((await readFile(capture, "utf8")).trim());
    expect(notice).toMatchObject({
      buttons: ["Continue"],
      message: "Experimental 4 GB memory limit removed",
      detail:
        "We found that the experimental mode can cause severe graphical corruption during long sessions. GWonMac has restored the standard 2 GB limit. The memory warning and Reload Guild Wars recovery remain available.",
    });
    const settings = JSON.parse(await readFile(
      path.join(fixture.userData, "settings.json"),
      "utf8",
    ));
    expect(settings.extendedMemoryEnabled).toBeUndefined();
    expect(settings.unknownField).toEqual({ preserved: true });
    await expect(stat(path.join(fixture.userData, "game", "extended-memory")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(
      path.join(fixture.userData, "game", "enhancements", "preserved"),
      "utf8",
    )).resolves.toBe("sibling");
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
    const secondCapture = path.join(fixture.userData, "second-notices.jsonl");
    relaunched = await launchOfflineAt(
      fixture.userData,
      environment(secondCapture),
    );
    await expect.poll(async () => {
      try {
        return (await readFile(secondCapture, "utf8")).trim().split("\n").filter(Boolean)
          .length;
      } catch {
        return 0;
      }
    }).toBe(0);
  } finally {
    if (relaunched) await closeOffline(relaunched);
    else if (fixture) await closeOffline(fixture);
  }
});
