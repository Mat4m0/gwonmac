import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initializeCompanionKernelBytes } from "../../src/renderer/companion-kernel-loader.ts";
import { ENHANCEMENT_CONFIG_WORD_COUNT } from "../../src/shared/enhancement-contracts.ts";
import { COMPANION_PLAY_REGION_BYTES } from "../../src/renderer/companion-play-region-snapshot.ts";
import {
  COMPANION_SKILL_COOLDOWN_BYTES,
  COMPANION_SKILL_SLOT_BYTES,
} from "../../src/renderer/companion-skill-snapshot.ts";
import {
  COMPANION_CURSOR_BYTES,
  COMPANION_PARTY_BYTES,
  COMPANION_SNAPSHOT_BYTES,
  COMPANION_TOOLBOX_BYTES,
} from "../../src/renderer/companion-snapshot.ts";
import { COMPANION_KERNEL_EXPORT_VALUES } from "../../scripts/companion-kernel-contract.mjs";
import { COMPANION_ABI } from "../../src/shared/companion-abi.ts";
import { companionKernelFixture } from "../helpers/companion-kernel-fixture.ts";

const CONFIG_BYTES = ENHANCEMENT_CONFIG_WORD_COUNT * 4;
const FEATURE_FLAGS = 999;

function request() {
  return {
    memory: new WebAssembly.Memory({ initial: 10 }),
    runtimePointer: 524_288,
    featureFlags: FEATURE_FLAGS,
    regions: {
      snapshot: { pointer: 65_536, bytes: COMPANION_SNAPSHOT_BYTES },
      config: { pointer: 131_072, bytes: CONFIG_BYTES },
      cursor: { pointer: 196_608, bytes: COMPANION_CURSOR_BYTES },
      toolbox: { pointer: 262_144, bytes: COMPANION_TOOLBOX_BYTES },
      party: { pointer: 327_680, bytes: COMPANION_PARTY_BYTES },
      skillSlots: { pointer: 393_216, bytes: COMPANION_SKILL_SLOT_BYTES },
      skillCooldowns: { pointer: 409_600, bytes: COMPANION_SKILL_COOLDOWN_BYTES },
      playRegion: { pointer: 425_984, bytes: COMPANION_PLAY_REGION_BYTES },
      characterList: { pointer: 450_560, bytes: COMPANION_ABI.characterList.bytes },
      playerEffects: { pointer: 475_136, bytes: COMPANION_ABI.playerEffects.bytes },
      effectIcons: { pointer: 491_520, bytes: COMPANION_ABI.effectIcons.bytes },
    },
  } as const;
}

function initArguments(): readonly number[] {
  return [
    65_536, COMPANION_SNAPSHOT_BYTES,
    131_072, CONFIG_BYTES,
    196_608, COMPANION_CURSOR_BYTES,
    262_144, COMPANION_TOOLBOX_BYTES,
    327_680, COMPANION_PARTY_BYTES,
    393_216, COMPANION_SKILL_SLOT_BYTES,
    409_600, COMPANION_SKILL_COOLDOWN_BYTES,
    425_984, COMPANION_PLAY_REGION_BYTES,
    450_560, COMPANION_ABI.characterList.bytes,
    0, 0,
    475_136, COMPANION_ABI.playerEffects.bytes,
    491_520, COMPANION_ABI.effectIcons.bytes,
    0,
    FEATURE_FLAGS,
  ];
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("companion kernel loader", () => {
  it("verifies, initializes, and projects only the canonical kernel", async () => {
    const bytes = companionKernelFixture({
      expectedInitArguments: initArguments(),
      cursorEventCount: 23,
    });

    const kernel = await initializeCompanionKernelBytes(bytes.buffer, request());

    assert.equal(kernel.sha256, await sha256(bytes));
    assert.equal(kernel.cursorEventCount(), 23);
    assert.doesNotThrow(() => kernel.dispatch(1, 2, 3, 4, 5, 6));
  });

  it("refuses extra and missing imports and exports", async () => {
    for (const [options, refusal] of [
      [{ extraImport: true }, /import surface is invalid/],
      [{ missingImport: true }, /import surface is invalid/],
      [{ extraExport: true }, /export surface is invalid/],
      [{ missingExport: true }, /export surface is invalid/],
    ] as const) {
      await assert.rejects(
        initializeCompanionKernelBytes(
          companionKernelFixture(options).buffer,
          request(),
        ),
        refusal,
      );
    }
  });

  it("refuses a canonical name with the wrong function signature", async () => {
    await assert.rejects(
      initializeCompanionKernelBytes(
        companionKernelFixture({ wrongSignature: true }).buffer,
        request(),
      ),
      /export signatures are invalid/,
    );
  });

  it("refuses every mismatched ABI scalar", async () => {
    const scalarNames = Object.keys(
      COMPANION_KERNEL_EXPORT_VALUES,
    ) as (keyof typeof COMPANION_KERNEL_EXPORT_VALUES)[];
    for (const scalarName of scalarNames) {
      await assert.rejects(
        initializeCompanionKernelBytes(
          companionKernelFixture({
            exportValueOverrides: { [scalarName]: -1 },
          }).buffer,
          request(),
        ),
        /rejected its ABI/,
        scalarName,
      );
    }
  });

  it("does not expose dispatch authority when initialization refuses", async () => {
    await assert.rejects(
      initializeCompanionKernelBytes(
        companionKernelFixture({ initResult: 0 }).buffer,
        request(),
      ),
      /rejected its ABI/,
    );
  });

  it("uses the canonical allocation validator before compilation", async () => {
    await assert.rejects(
      initializeCompanionKernelBytes(new ArrayBuffer(0), {
        ...request(),
        runtimePointer: 524_289,
      }),
      /not 16-byte aligned/,
    );
    await assert.rejects(
      initializeCompanionKernelBytes(new ArrayBuffer(0), {
        ...request(),
        regions: {
          ...request().regions,
          config: { pointer: 524_288, bytes: CONFIG_BYTES },
        },
      }),
      /kernel runtime\/config allocations overlap/,
    );
  });
});
