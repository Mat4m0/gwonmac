import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  ENHANCEMENT_CAPABILITY_PROFILES,
  ENHANCEMENT_TRANSFORM_ABI,
  type EnhancementCapabilityProfile,
  type EnhancementCapabilities,
} from "../../src/shared/enhancement-contracts.js";
import {
  inspectEnhancementCache,
  prepareClientModule,
  type ClientCertification,
} from "../../src/main/certification/client-module.js";
import {
  rewriteTemplateSaveWasm,
  TEMPLATE_SAVE_TRANSFORM_ABI,
  type KnownTemplateSaveBuild,
} from "../../src/main/certification/template-save-compat.js";
import {
  type EnhancementOutputHashes,
  type KnownEnhancementBuild,
} from "../../src/main/certification/enhancement-builds.js";
import {
  ENHANCEMENT_HOOK_EXPORT,
  ENHANCEMENT_MANIFEST_SECTION,
  transformEnhancementWasm,
} from "../../src/main/certification/enhancement-transform.js";
import {
  parseCode,
  sectionById,
  splitSections,
} from "../../src/main/core/wasm-binary.js";

const CURSOR_TOOLBOX: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  partyObservation: true,
  commands: false,
  storage: false,
});
const CURSOR_ONLY: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: false,
  partyObservation: false,
  commands: false,
  storage: false,
});
const CURSOR_TARGET: EnhancementCapabilities = Object.freeze({
  nativeCursor: true,
  targetObservation: true,
  partyObservation: false,
  commands: false,
  storage: false,
});
const NO_CAPABILITIES: EnhancementCapabilities = Object.freeze({
  nativeCursor: false,
  targetObservation: false,
  partyObservation: false,
  commands: false,
  storage: false,
});

const scratchDirs: string[] = [];
after(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function uleb(value: number): number[] {
  const output: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    output.push(byte);
  } while (value);
  return output;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

function paddedCall(index: number): number[] {
  const bytes = [0x10];
  for (let position = 0; position < 5; position += 1) {
    bytes.push((index & 0x7f) | (position === 4 ? 0 : 0x80));
    index >>>= 7;
  }
  return bytes;
}

const STUB_BODY = [0x00, 0x41, 0x02, 0x0b];
const CALL_OFFSET = 5;

/**
 * One real module that both production transforms accept: a template-save
 * stub/caller plus the exported typed loop and empty table slot Enhancement needs.
 */
function officialFixture(): Uint8Array {
  const types = section(1, [
    6,
    0x60, 2, 0x7f, 0x7f, 1, 0x7f,
    0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
    0x60, 1, 0x7f, 0,
    0x60, 5, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0,
    0x60, 3, 0x7f, 0x7f, 0x7f, 0,
    0x60, 2, 0x7f, 0x7f, 0,
  ]);
  const imports = section(2, [1, 1, 109, 1, 97, 0, 1]);
  const functions = section(3, [12, 0, 0, 2, 3, 4, 5, 5, 4, 4, 2, 0, 3]);
  const table = section(4, [1, 0x70, 1, 5, 5]);
  const memory = section(5, [1, 1, 1, 1]);
  const globals = section(6, [0]);
  const callerName = [...new TextEncoder().encode("caller")];
  const loopName = [
    ...new TextEncoder().encode("EmscriptenExeThreadMainLoop"),
  ];
  const exports = section(7, [
    4,
    ...uleb(callerName.length), ...callerName, 0, 2,
    ...uleb(loopName.length), ...loopName, 0, 3,
    3, 116, 98, 108, 1, 0,
    6, 109, 101, 109, 111, 114, 121, 2, 0,
  ]);
  const elements = section(9, [
    2,
    0, 0x41, 1, 0x0b, 3, 4, 3, 5,
    0, 0x41, 4, 0x0b, 1, 6,
  ]);
  const caller = [
    0,
    0x20, 0,
    0x20, 1,
    ...paddedCall(1),
    0x0b,
  ];
  const loop = [0, 0x0b];
  const slashParser = [0, 0x41, 0, 0x0b];
  const code = section(10, [
    12,
    ...uleb(STUB_BODY.length), ...STUB_BODY,
    ...uleb(caller.length), ...caller,
    ...uleb(loop.length), ...loop,
    ...uleb(loop.length), ...loop,
    ...uleb(loop.length), ...loop,
    ...uleb(loop.length), ...loop,
    ...uleb(loop.length), ...loop,
    ...uleb(loop.length), ...loop,
    ...uleb(loop.length), ...loop,
    ...uleb(loop.length), ...loop,
    ...uleb(slashParser.length), ...slashParser,
    ...uleb(loop.length), ...loop,
  ]);
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...types,
    ...imports,
    ...functions,
    ...table,
    ...memory,
    ...globals,
    ...exports,
    ...elements,
    ...code,
  ]);
}

function certifyTemplate(input: Uint8Array): KnownTemplateSaveBuild {
  const draft: KnownTemplateSaveBuild = {
    sha256: sha256(input),
    outputSha256: "0".repeat(64),
    importCount: 1,
    carrierImport: 0,
    bridges: [
      {
        kind: "ensureDirectory",
        stubFunction: 0,
        stubBody: STUB_BODY,
        callSites: [{ localFunction: 1, bodyOffset: CALL_OFFSET }],
      },
    ],
  };
  try {
    rewriteTemplateSaveWasm(input, draft);
  } catch (error) {
    const found = /unexpected output ([0-9a-f]{64})/.exec(String(error));
    if (found) return { ...draft, outputSha256: found[1]! };
  }
  return assert.fail("fixture did not produce a template-save output hash");
}

function enhancementBuild(input: Uint8Array): KnownEnhancementBuild {
  const draft: KnownEnhancementBuild = {
    sha256: sha256(input),
    outputSha256: Object.freeze({
      cursor: "0".repeat(64),
      target: "0".repeat(64),
      cursorTarget: "0".repeat(64),
      party: "0".repeat(64),
      cursorParty: "0".repeat(64),
      targetParty: "0".repeat(64),
      cursorTargetParty: "0".repeat(64),
      partyCommands: "0".repeat(64),
      cursorPartyCommands: "0".repeat(64),
      targetPartyCommands: "0".repeat(64),
      cursorTargetPartyCommands: "0".repeat(64),
      partyStorage: "0".repeat(64),
      cursorPartyStorage: "0".repeat(64),
      targetPartyStorage: "0".repeat(64),
      cursorTargetPartyStorage: "0".repeat(64),
      partyCommandsStorage: "0".repeat(64),
      cursorPartyCommandsStorage: "0".repeat(64),
      targetPartyCommandsStorage: "0".repeat(64),
      cursorTargetPartyCommandsStorage: "0".repeat(64),
      storage: "0".repeat(64),
    }),
    programId: 1,
    buildId: 1,
    hookFunction: 3,
    hookParams: ["i32"],
    hookResults: [],
    hookBodySha256: sha256(parseCode(sectionById(splitSections(input), 10))[2]!),
    tableSlot: 5,
    observationBase: { layout: {
      contextRoot: 1, agentArray: 2, gameContextSlot: 6,
      characterContext: 4, mapId: 5, isExplorable: 6,
      currentMapId: 7, currentInstanceType: 8, playerNumber: 9,
      agentId: 10, agentPlayerNumber: 14, agentModelType: 15,
      agentX: 11, agentY: 12, agentType: 13,
      worldContext: 46, areaInfo: 72, areaInfoCount: 73,
      areaInfoStride: 74, areaInfoFlags: 75,
    } },
    storage: {
        openExport: "enhancement_open_storage",
        configureExport: "enhancement_configure_storage",
        travel: {
          enqueueExport: "enhancement_travel",
          configureExport: "enhancement_configure_travel",
          toggleExport: "enhancement_take_travel_toggle",
          messageId: 0x1000_0183,
          producer: {
            functionIndex: 12,
            params: ["i32", "i32", "i32", "i32", "i32"],
            results: [],
            bodySha256: sha256(
              parseCode(sectionById(splitSections(input), 10))[11]!,
            ),
          },
        },
        slashParser: {
          functionIndex: 11,
          params: ["i32", "i32"],
          results: ["i32"],
          bodySha256: sha256(
            parseCode(sectionById(splitSections(input), 10))[10]!,
          ),
        },
        handler: {
          functionIndex: 10,
          params: ["i32"],
          results: [],
          bodySha256: sha256(
            parseCode(sectionById(splitSections(input), 10))[9]!,
          ),
        },
    },
    gameThread: {
      drain: {
        functionIndex: 6,
        params: ["i32", "i32"],
        results: [],
        tableSlot: 4,
        bodySha256:
          "f09a7a12954169ae595d12d870e69a4c0092003157d72523d626d2a3990241e2",
      },
    },
    teamApply: {
      thunkExport: "enhancement_command",
      professionTrace: {
        readerExport: "enhancement_profession_trace",
        sender: {
          functionIndex: 8,
          params: ["i32", "i32", "i32"],
          results: [],
          bodySha256: sha256(parseCode(sectionById(splitSections(input), 10))[7]!),
        },
      },
      entries: [{
        opcode: 65,
        functionIndex: 7,
        params: ["i32", "i32"],
        results: [],
        bodySha256: sha256(parseCode(sectionById(splitSections(input), 10))[6]!),
        label: "fixture profession command",
      }, {
        opcode: 93,
        functionIndex: 9,
        params: ["i32", "i32", "i32"],
        results: [],
        bodySha256: sha256(parseCode(sectionById(splitSections(input), 10))[8]!),
        label: "fixture skill-bar command",
      }],
    },
    cursorEvent: {
      functionIndex: 4,
      params: ["i32", "i32", "i32", "i32", "i32"],
      results: [],
      tableSlot: 1,
      producerFunctions: [4, 4],
      producerParams: [
        ["i32", "i32", "i32", "i32", "i32"],
        ["i32", "i32", "i32", "i32", "i32"],
      ],
      producerResults: [[], []],
      bodySha256: sha256(parseCode(sectionById(splitSections(input), 10))[3]!),
      producerBodySha256: [
        sha256(parseCode(sectionById(splitSections(input), 10))[3]!),
        sha256(parseCode(sectionById(splitSections(input), 10))[3]!),
      ],
      tableNeighbourBodySha256: [
        sha256(parseCode(sectionById(splitSections(input), 10))[2]!),
        sha256(parseCode(sectionById(splitSections(input), 10))[4]!),
      ],
      layout: {
        cursorActiveArt: 16, cursorSoftwareModel: 17, cursorShowCount: 18,
        cursorColorBuffer: 19, cursorArtHotspot: 0, cursorArtTexture: 12,
        cursorHandleKey: 8, cursorHandleObject: 0, cursorViewTexture: 8,
        cursorTextureType: 12, cursorTextureWidth: 20, cursorTextureHeight: 24,
      },
    },
    targetObservation: { layout: {
      manualTargetAgentId: 3, automaticTargetAgentId: 4,
    } },
    uiDispatcher: {
      functionIndex: 5,
      params: ["i32", "i32", "i32"],
      results: [],
      bodySha256: sha256(parseCode(sectionById(splitSections(input), 10))[4]!),
      playerChatMessage: 0x1000_0082,
      hideHeroPanelMessage: 0x1000_01a3,
      showHeroPanelMessage: 0x1000_01a4,
    },
    partyObservation: {
      partyDirtyMessages: [
        0x1000_0038,
        0x1000_0039,
        0x1000_008c,
        0x1000_0098,
        0x1000_00c2,
        0x1000_0111,
        0x1000_011e,
        0x1000_011f,
        0x1000_0124,
        0x1000_0126,
      ],
      playerChatProducer: 5,
      playerChatSites: 3,
      nearbyPlayerMessages: [0x1000_007f, 0x1000_0080],
      nearbyPlayerMessageProducers: [5, 5],
      layout: {
      partyContext: 28,
      playerParty: 32,
      partyHeroes: 36,
      heroMemberStride: 24,
      heroAgentId: 0,
      heroOwnerPlayerId: 4,
      heroId: 8,
      heroLevel: 42,
      partyPlayers: 43,
      partyHenchmen: 44,
      partyFlag: 45,
      accountContext: 78,
      accountUnlockedSkills: 79,
      worldHeroFlags: 47,
      heroFlagStride: 48,
      flagHeroId: 49,
      flagAgentId: 50,
      flagBehavior: 51,
      worldHeroInfo: 52,
      heroInfoStride: 53,
      infoHeroId: 54,
      infoAgentId: 40,
      infoLevel: 41,
      infoPrimary: 55,
      infoSecondary: 56,
      infoAppearanceBitmap: 57,
      worldSkillbars: 58,
      skillbarStride: 59,
      skillbarAgentId: 60,
      skillbarSkills: 61,
      skillSlotStride: 62,
      skillSlotId: 63,
      skillbarDisabled: 64,
      worldAttributes: 65,
      attributeStride: 66,
      attributeAgentId: 67,
      attributeEntries: 68,
      attributeEntryStride: 69,
      attributeEntryId: 70,
      attributeEntryRank: 71,
      worldProfessionStates: 76,
      professionStateStride: 77,
      worldCharacterSkills: 80,
      },
    },
  };
  const derived = {} as Record<EnhancementCapabilityProfile, string>;
  for (const profile of Object.keys(ENHANCEMENT_CAPABILITY_PROFILES) as
    EnhancementCapabilityProfile[]) {
    derived[profile] = sha256(transformEnhancementWasm(
      input,
      draft,
      ENHANCEMENT_CAPABILITY_PROFILES[profile],
    ));
  }
  return {
    ...draft,
    outputSha256: Object.freeze(derived) as EnhancementOutputHashes,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gw-client-module-"));
  scratchDirs.push(root);
  const official = officialFixture();
  const officialWasmPath = join(root, "official.wasm");
  const officialJsPath = join(root, "official.js");
  await writeFile(officialWasmPath, official);
  await writeFile(officialJsPath, "official glue");
  const templateSaveBuild = certifyTemplate(official);
  const templateOutput = rewriteTemplateSaveWasm(official, templateSaveBuild);
  const enhancement = enhancementBuild(templateOutput);
  return {
    root,
    official,
    officialWasmPath,
    officialJsPath,
    officialSha256: sha256(official),
    templateSaveBuild,
    enhancementBuild: enhancement,
    compatibilityCacheRoot: join(root, "compatibility"),
    enhancementCacheRoot: join(root, "enhancement"),
    nativeDoubleClickCacheRoot: join(root, "double-click"),
  };
}

type ModuleFixture = Awaited<ReturnType<typeof fixture>>;

function options(
  value: ModuleFixture,
  certification: ClientCertification,
  enhancementCapabilities: EnhancementCapabilities,
) {
  return {
    officialWasmPath: value.officialWasmPath,
    officialJsPath: value.officialJsPath,
    officialSha256: value.officialSha256,
    certification,
    enhancementCapabilities,
    compatibilityCacheRoot: value.compatibilityCacheRoot,
    enhancementCacheRoot: value.enhancementCacheRoot,
    nativeDoubleClickCacheRoot: value.nativeDoubleClickCacheRoot,
  };
}

async function seedCache(cacheRoot: string): Promise<void> {
  const dir = join(cacheRoot, "stale", "0");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "Gw.jspi.wasm"), "stale");
}

async function assertMissing(directory: string): Promise<void> {
  await assert.rejects(readdir(directory), { code: "ENOENT" });
}

describe("client module preparation", () => {
  it("composes both certified transforms in order", async () => {
    const value = await fixture();
    const certification: ClientCertification = {
      templateSaveBuild: value.templateSaveBuild,
      enhancementBuild: value.enhancementBuild,
    };

    const prepared = await prepareClientModule(
      options(value, certification, CURSOR_TOOLBOX),
    );

    assert.deepEqual(prepared.gameFileSaving, { status: "available" });
    assert.deepEqual(prepared.effectiveCapabilities, CURSOR_TOOLBOX);
    assert.equal(prepared.enhancementBuild, value.enhancementBuild);
    assert.equal(prepared.failure, null);
    assert.notEqual(prepared.wasmPath, value.officialWasmPath);
    assert.equal(
      await inspectEnhancementCache(
        value.enhancementBuild,
        CURSOR_TOOLBOX,
        value.enhancementCacheRoot,
      ),
      "valid",
    );

    const output = await readFile(prepared.wasmPath);
    const module = new WebAssembly.Module(output);
    assert.ok(
      WebAssembly.Module.exports(module).some(
        (entry) => entry.name === ENHANCEMENT_HOOK_EXPORT,
      ),
    );
    assert.equal(
      WebAssembly.Module.customSections(module, ENHANCEMENT_MANIFEST_SECTION).length,
      1,
    );

    const seen: number[][] = [];
    const instance = new WebAssembly.Instance(module, {
      m: {
        a: (...args: number[]) => {
          seen.push(args);
          return 0;
        },
      },
    });
    const caller = instance.exports.caller as (
      path: number,
      recursive: number,
    ) => number;
    assert.equal(caller(0x1234, 1), 0);
    assert.deepEqual(seen, [[-70001, 0x1234, 0, 1]]);
  });

  it("prepares only templates for a template-only certification", async () => {
    const value = await fixture();
    await seedCache(value.enhancementCacheRoot);

    const prepared = await prepareClientModule(
      options(
        value,
        {
          templateSaveBuild: value.templateSaveBuild,
          enhancementBuild: null,
        },
        CURSOR_TOOLBOX,
      ),
    );

    assert.deepEqual(prepared.gameFileSaving, { status: "available" });
    assert.deepEqual(prepared.effectiveCapabilities, NO_CAPABILITIES);
    assert.equal(prepared.enhancementBuild, null);
    assert.equal(prepared.failure, null);
    assert.equal(
      sha256(await readFile(prepared.wasmPath)),
      value.templateSaveBuild.outputSha256,
    );
    await assertMissing(value.enhancementCacheRoot);
  });

  it("serves official bytes and drops both caches when uncertified", async () => {
    const value = await fixture();
    await Promise.all([
      seedCache(value.compatibilityCacheRoot),
      seedCache(value.enhancementCacheRoot),
    ]);

    const prepared = await prepareClientModule(
      options(value, { templateSaveBuild: null, enhancementBuild: null }, CURSOR_TOOLBOX),
    );

    assert.deepEqual(prepared, {
      wasmPath: value.officialWasmPath,
      jsPath: value.officialJsPath,
      gameFileSaving: { status: "unavailable", reason: "game-update" },
      enhancementBuild: null,
      requestedCapabilities: CURSOR_TOOLBOX,
      effectiveCapabilities: NO_CAPABILITIES,
      // An unrecognised client is served exactly as downloaded, so it also
      // never receives the double-click transform: the renderer keeps
      // synthesising taps rather than being handed a module nothing certified.
      nativeDoubleClick: false,
      failure: null,
    });
    await Promise.all([
      assertMissing(value.compatibilityCacheRoot),
      assertMissing(value.enhancementCacheRoot),
    ]);
  });

  it("closes native double-click preparation when its input disappears", async () => {
    const value = await fixture();
    const missingWasmPath = join(value.root, "missing.wasm");
    const request = options(
      value,
      { templateSaveBuild: null, enhancementBuild: null },
      CURSOR_TOOLBOX,
    );
    request.officialWasmPath = missingWasmPath;

    const prepared = await prepareClientModule(request);

    assert.equal(prepared.wasmPath, missingWasmPath);
    assert.deepEqual(prepared.gameFileSaving, {
      status: "unavailable",
      reason: "game-update",
    });
    assert.equal(prepared.nativeDoubleClick, false);
    assert.equal(prepared.failure?.stage, "native-double-click");
  });

  it("drops the Enhancement cache when the certified tool is disabled", async () => {
    const value = await fixture();
    await seedCache(value.enhancementCacheRoot);

    const prepared = await prepareClientModule(
      options(
        value,
        {
          templateSaveBuild: value.templateSaveBuild,
          enhancementBuild: value.enhancementBuild,
        },
        NO_CAPABILITIES,
      ),
    );

    assert.deepEqual(prepared.gameFileSaving, { status: "available" });
    assert.equal(prepared.enhancementBuild, null);
    assert.equal(prepared.failure, null);
    assert.equal(
      sha256(await readFile(prepared.wasmPath)),
      value.templateSaveBuild.outputSha256,
    );
    await assertMissing(value.enhancementCacheRoot);
  });

  it("falls back at the failed stage without serving an invalid module", async () => {
    const templateFailure = await fixture();
    await seedCache(templateFailure.enhancementCacheRoot);
    const brokenTemplate = {
      ...templateFailure.templateSaveBuild,
      outputSha256: "0".repeat(64),
    };
    const afterTemplateFailure = await prepareClientModule(
      options(
        templateFailure,
        { templateSaveBuild: brokenTemplate, enhancementBuild: null },
        CURSOR_TOOLBOX,
      ),
    );
    assert.equal(afterTemplateFailure.wasmPath, templateFailure.officialWasmPath);
    assert.deepEqual(afterTemplateFailure.gameFileSaving, {
      status: "unavailable",
      reason: "preparation-failed",
    });
    assert.equal(afterTemplateFailure.failure?.stage, "template-save");
    await assertMissing(templateFailure.enhancementCacheRoot);

    const enhancementFailure = await fixture();
    const brokenEnhancement = {
      ...enhancementFailure.enhancementBuild,
      hookFunction: 999,
    };
    const afterEnhancementFailure = await prepareClientModule(
      options(
        enhancementFailure,
        {
          templateSaveBuild: enhancementFailure.templateSaveBuild,
          enhancementBuild: brokenEnhancement,
        },
        CURSOR_TOOLBOX,
      ),
    );
    assert.deepEqual(afterEnhancementFailure.gameFileSaving, { status: "available" });
    assert.equal(afterEnhancementFailure.enhancementBuild, brokenEnhancement);
    assert.deepEqual(afterEnhancementFailure.effectiveCapabilities, NO_CAPABILITIES);
    assert.equal(afterEnhancementFailure.failure?.stage, "enhancement");
    assert.equal(
      sha256(await readFile(afterEnhancementFailure.wasmPath)),
      enhancementFailure.templateSaveBuild.outputSha256,
    );
  });

  it("rebuilds stale compatibility and Enhancement cache entries", async () => {
    const value = await fixture();
    const certification: ClientCertification = {
      templateSaveBuild: value.templateSaveBuild,
      enhancementBuild: value.enhancementBuild,
    };
    const first = await prepareClientModule(
      options(value, certification, CURSOR_TOOLBOX),
    );
    const compatibilityWasm = join(
      value.compatibilityCacheRoot,
      value.officialSha256,
      String(TEMPLATE_SAVE_TRANSFORM_ABI),
      "Gw.jspi.wasm",
    );
    await Promise.all([
      writeFile(compatibilityWasm, "tampered"),
      writeFile(first.wasmPath, "tampered"),
    ]);

    const rebuilt = await prepareClientModule(
      options(value, certification, CURSOR_TOOLBOX),
    );

    assert.equal(rebuilt.failure, null);
    assert.equal(
      sha256(await readFile(compatibilityWasm)),
      value.templateSaveBuild.outputSha256,
    );
    assert.equal(WebAssembly.validate(await readFile(rebuilt.wasmPath)), true);
    assert.equal(
      await inspectEnhancementCache(
        value.enhancementBuild,
        CURSOR_TOOLBOX,
        value.enhancementCacheRoot,
      ),
      "valid",
    );
  });

  it("rejects a replacement module even when writable metadata matches it", async () => {
    const value = await fixture();
    const certification: ClientCertification = {
      templateSaveBuild: value.templateSaveBuild,
      enhancementBuild: value.enhancementBuild,
    };
    const first = await prepareClientModule(
      options(value, certification, CURSOR_TOOLBOX),
    );
    const metadataPath = join(
      value.enhancementCacheRoot,
      value.enhancementBuild.sha256,
      String(ENHANCEMENT_TRANSFORM_ABI),
      "metadata.json",
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      outputSha256: string;
    };
    const planted = Buffer.from("attacker-controlled-wasm");
    metadata.outputSha256 = sha256(planted);
    await Promise.all([
      writeFile(first.wasmPath, planted),
      writeFile(metadataPath, JSON.stringify(metadata)),
    ]);

    assert.equal(
      await inspectEnhancementCache(
        value.enhancementBuild,
        CURSOR_TOOLBOX,
        value.enhancementCacheRoot,
      ),
      "missing-or-invalid",
    );
    const rebuilt = await prepareClientModule(
      options(value, certification, CURSOR_TOOLBOX),
    );
    assert.equal(rebuilt.failure, null);
    assert.equal(
      sha256(await readFile(rebuilt.wasmPath)),
      value.enhancementBuild.outputSha256.cursorParty,
    );
  });

  it("selects the largest safe subset when one profile fails validation", async () => {
    const value = await fixture();
    const complete = value.enhancementBuild.outputSha256;
    const failedProfile = {
      ...value.enhancementBuild,
      outputSha256: {
        ...complete,
        cursorParty: "0".repeat(64),
      } satisfies EnhancementOutputHashes,
    };

    const prepared = await prepareClientModule(
      options(
        value,
        {
          templateSaveBuild: value.templateSaveBuild,
          enhancementBuild: failedProfile,
        },
        CURSOR_TOOLBOX,
      ),
    );

    assert.deepEqual(prepared.gameFileSaving, { status: "available" });
    assert.equal(prepared.enhancementBuild, failedProfile);
    assert.equal(prepared.failure?.stage, "enhancement");
    assert.deepEqual(prepared.effectiveCapabilities, CURSOR_ONLY);
    assert.equal(
      sha256(await readFile(prepared.wasmPath)),
      complete.cursor,
    );
  });

  it("replaces the cache when capabilities change but hooks do not", async () => {
    const value = await fixture();
    const certification: ClientCertification = {
      templateSaveBuild: value.templateSaveBuild,
      enhancementBuild: value.enhancementBuild,
    };

    const cursorOnly = await prepareClientModule(
      options(value, certification, CURSOR_ONLY),
    );
    const cursorBytes = await readFile(cursorOnly.wasmPath);
    assert.equal(
      await inspectEnhancementCache(
        value.enhancementBuild,
        CURSOR_ONLY,
        value.enhancementCacheRoot,
      ),
      "valid",
    );
    assert.equal(
      await inspectEnhancementCache(
        value.enhancementBuild,
        CURSOR_TARGET,
        value.enhancementCacheRoot,
      ),
      "missing-or-invalid",
    );

    const cursorTarget = await prepareClientModule(
      options(value, certification, CURSOR_TARGET),
    );
    const cursorTargetBytes = await readFile(cursorTarget.wasmPath);
    assert.equal(cursorTarget.wasmPath, cursorOnly.wasmPath);
    assert.notEqual(sha256(cursorTargetBytes), sha256(cursorBytes));
    assert.equal(
      await inspectEnhancementCache(
        value.enhancementBuild,
        CURSOR_TARGET,
        value.enhancementCacheRoot,
      ),
      "valid",
    );
    assert.equal(
      await inspectEnhancementCache(
        value.enhancementBuild,
        CURSOR_ONLY,
        value.enhancementCacheRoot,
      ),
      "missing-or-invalid",
    );
  });
});
