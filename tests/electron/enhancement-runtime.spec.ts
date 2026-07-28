import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
// The contracts come from the source, not from `build/`. Importing the emitted
// copy made `tsc -p tsconfig.tests.json` depend on a current build — the exact
// second source of truth Phase 0b removed from the tooling scripts, and the
// reason `pnpm typecheck` can run before `pnpm build` in `pnpm verify`.
import { prepareClientModule } from "../../src/main/core/client-module.js";
import { gamePaths } from "../../src/main/core/paths.js";
import { loadSettings } from "../../src/main/core/settings.js";
import { ENHANCEMENT_BUILDS } from "../../src/main/core/enhancement-builds.js";
import {
  closeOffline,
  launchOffline,
  main,
} from "./fixtures.mjs";

// A real, canonical WebAssembly module with one empty function. An empty
// template bridge list leaves it byte-identical, which isolates the Enhancement
// choice: any manifest or hook in the selected output could only have come
// from the Enhancement transform.
const OFFICIAL_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);
const OFFICIAL_SHA256 = createHash("sha256")
  .update(OFFICIAL_WASM)
  .digest("hex");

const [CERTIFIED_ENHANCEMENT_BUILD] = ENHANCEMENT_BUILDS;
if (!CERTIFIED_ENHANCEMENT_BUILD) {
  throw new Error("the Enhancement build registry is empty");
}

test.describe("Enhancement runtime selection", () => {
  test.skip(!existsSync(main), "run the build before Electron tests");

  test("all tools off removes the cache and selects an unmodified module", async () => {
    const fixture = await launchOffline(
      "gw-enhancement-off-preparation-e2e-",
      {},
      async (userData) => {
        const game = path.join(userData, "game");
        await Promise.all([
          mkdir(path.join(game, "artifacts"), { recursive: true }),
          mkdir(path.join(game, "enhancements", "stale", "0"), {
            recursive: true,
          }),
        ]);
        await Promise.all([
          writeFile(
            path.join(userData, "settings.json"),
            JSON.stringify({
              nativeCursor: false,
              targetReadout: false,
            }),
            { mode: 0o600 },
          ),
          writeFile(
            path.join(game, "artifacts", "Gw.jspi.wasm"),
            OFFICIAL_WASM,
          ),
          writeFile(
            path.join(game, "enhancements", "stale", "0", "Gw.jspi.wasm"),
            "stale Enhancement output",
          ),
        ]);
      },
    );

    try {
      const init = await fixture.page.evaluate(() => window.gwNative.init);
      expect(init).toEqual({
        enhancementAutomation: false,
        enhancementSelection: {
          nativeCursor: false,
          targetReadout: false,
          teamManagement: false,
        },
        templateFsTrace: false,
      });
      const enhancementRequested =
        init.enhancementAutomation
        || Object.values(init.enhancementSelection).some(Boolean);
      const paths = gamePaths(fixture.userData);
      const settings = await loadSettings(paths.settings);
      expect(settings).toMatchObject(init.enhancementSelection);
      const selected = await prepareClientModule({
        officialWasmPath: path.join(paths.artifacts, "Gw.jspi.wasm"),
        officialSha256: OFFICIAL_SHA256,
        certification: {
          state: "certified",
          templateSaveBuild: {
            sha256: OFFICIAL_SHA256,
            outputSha256: OFFICIAL_SHA256,
            importCount: 0,
            carrierImport: 0,
            bridges: [],
          },
          enhancementBuild: {
            ...CERTIFIED_ENHANCEMENT_BUILD,
            sha256: OFFICIAL_SHA256,
          },
        },
        enhancementRequested,
        compatibilityCacheRoot: paths.compatibility,
        enhancementCacheRoot: paths.enhancements,
      });
      const bytes = await readFile(selected.wasmPath);
      const module = new WebAssembly.Module(bytes);
      const enhancementCacheExists = await stat(paths.enhancements).then(
        () => true,
        () => false,
      );

      expect({
        enhancementRequested,
        selectedState: selected.state,
        selectedEnhancementBuild: selected.enhancementBuild,
        selectedFailure: selected.failure,
        selectedUnderCompatibilityCache:
          selected.wasmPath.startsWith(paths.compatibility),
        enhancementCacheExists,
        manifestSections: WebAssembly.Module.customSections(
          module,
          "enhancement_manifest",
        ).length,
        enhancementHookExports: WebAssembly.Module.exports(module)
          .filter((entry) => entry.name.startsWith("enhancement_"))
          .map((entry) => entry.name),
      }).toEqual({
        enhancementRequested: false,
        selectedState: "certified",
        selectedEnhancementBuild: null,
        selectedFailure: null,
        selectedUnderCompatibilityCache: true,
        enhancementCacheExists: false,
        manifestSections: 0,
        enhancementHookExports: [],
      });
    } finally {
      await closeOffline(fixture);
    }
  });
});
