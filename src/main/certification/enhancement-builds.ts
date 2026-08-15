/**
 * The registry of retained exact-build Enhancement certificates.
 * Certificate structure and validation live in enhancement-build-model.
 */
import {
  hasCompleteEnhancementProfileHashes,
  type KnownEnhancementBuild,
} from "./enhancement-build-model.js";
export * from "./enhancement-build-model.js";

// Canonical signed facts for the one retained exact-build certificate. Older
// client generations keep file-saving and structural cursor recovery, but are
// not advertised here when their full output chain cannot be reproduced.

// Canonical support manifest. Every value is verified against the exact input
// hash before a derived module is selected.
//
// The input is the template-save client, not the raw official module: that
// transform is the floor every launch lands on, and the Enhancement transform is
// layered on top so opting in never costs template save/load. It only appends
// functions and reserves one new terminal table entry, so the main-loop index,
// original table size and every data address below are certified separately for
// each exact template-save output. Unknown
// Enhancement builds remain off until another complete exact entry is added.
export const ENHANCEMENT_BUILDS: readonly KnownEnhancementBuild[] =
  Object.freeze([
    Object.freeze({
      sha256:
        "7d0ced840d3dc167b823ed0ad6ed411319faf97316345c8e37620e86d86f536e",
      // Recomputed when the bounded Travel action landed. All profiles move
      // together whenever the manifest's bytes do, and the manifest carries the
      // transform ABI and every config word -- so a command-only change also
      // changes the output of profiles that do not expose commands.
      //
      // `pnpm check` cannot catch a stale value here. The transform input is a
      // derived game binary this repository does not contain, so nothing in the
      // suite can run the transform; the first thing that notices is a launch
      // that installs no enhancement at all. Recompute by running
      // `transformEnhancementWasm` against the real derived module whenever
      // ENHANCEMENT_TRANSFORM_ABI or any config word changes.
      outputSha256: Object.freeze({
        cursor:
          "0d8663dd9bf005f0722d287eb3c83e9d6bfc8552f888d6e618ee7507457c244b",
        target:
          "70f1fe8c9aadb4653b3908e57254f89cb34249cc275fa8b8279df694fd190bae",
        cursorTarget:
          "a99b11b931ecd091f6c493eb25acf128a7e2a19d360da017066ffb3f6aef5742",
        party:
          "6e84233490f32fa754a0249132345f9b09ef98c2bd65f6858454813c20f19998",
        cursorParty:
          "f764101cc5b57095fe65e32154e6571d3c543c6dae1bdfa6275f4368812beac0",
        targetParty:
          "794fb82a4eeb653ae8a189d2214934a4ab4c14194fbea7c9c00d2aa2c394c290",
        cursorTargetParty:
          "faa30ad12005cefe7cdd2edca5ad1af77181fe3355be10403f3b47105a96a5f9",
        partyCommands:
          "c48095e2bd0c5d945226553d47c169e80142a17430772b80656d5dcf86013cc0",
        cursorPartyCommands:
          "6876309347c839dc6e95d81407a00b5615ad9c891464112d30a9f66706db997c",
        targetPartyCommands:
          "d7e532cdf17d217d8e970b257ea34feaf4b2d23c001ff2a9c746b023dcbdc20b",
        cursorTargetPartyCommands:
          "c134e23276232fad22404ebe5479684416f62126473687f3c0f26945eb72ecdd",
        partyStorage:
          "84be9b4d06e434ac74fa04c80cca58b6102694ac54a22072b8531aeaf2377f24",
        cursorPartyStorage:
          "d11f190e2e7982da5e21636c45600bbc79a699e81bd804ef9f16f87a1da93048",
        targetPartyStorage:
          "e681b50367efbcc933d4c4e9f529cfffa94d38d3f0e25176e4900c66c0d0bf60",
        cursorTargetPartyStorage:
          "15fff41f382574ec664674841e75dc2c11ff3f0877abfcfc03d92129a6b3afcc",
        partyCommandsStorage:
          "4e1b14bc5725ca2ff1c620c6db89bd34f426ba5b4efa043d0c42280d645ceb5e",
        cursorPartyCommandsStorage:
          "ac124f6c29774a2211bac75ca60694ae8a2f13494f7f4f7d220059ac467d8d80",
        targetPartyCommandsStorage:
          "d780fb35bee8fb3fbafa8a06ff24a63b787b6a90fef6714dc586eca9c2e817ba",
        cursorTargetPartyCommandsStorage:
          "cc15e0c84bf98aea363ff1cb23a0ad6534dd953ef0252d23a8574f1368f39565",
      }),
      programId: 1,
      // Function #477 returns 38,833 as a single i32 constant. The same function
      // returned 38,797 in the preceding certified client; diagnostics must
      // confirm that value again during the live patch-day run.
      buildId: 38833,
      hookFunction: 446,
      hookParams: Object.freeze(["i32"] as const),
      hookResults: Object.freeze([] as const),
      hookBodySha256:
        "82841ec302481a8960cd7a03aa76732e9a4faf7ec3ea136411fdd86906ea6b05",
      // The input table is fixed at 4,683 entries. The transform extends both
      // limits once and owns only this new terminal entry; statically empty input
      // slot 0 is a game runtime sentinel and must remain untouched.
      tableSlot: 4683,
      observationBase: Object.freeze({
        layout: Object.freeze({
          contextRoot: 0x5a0ee0,
          agentArray: 0x5a4e58,
          gameContextSlot: 6,
          characterContext: 0x44,
          mapId: 0x198,
          isExplorable: 0x19c,
          currentMapId: 0x234,
          currentInstanceType: 0x23c,
          playerNumber: 0x2ac,
          agentId: 0x2c,
          agentPlayerNumber: 0xf4,
          agentModelType: 0xf6,
        }),
      }),
      cursorEvent: Object.freeze({
        functionIndex: 2469,
        params: Object.freeze(["i32", "i32", "i32", "i32", "i32"] as const),
        results: Object.freeze([] as const),
        tableSlot: 922,
        producerFunctions: Object.freeze([2828, 2834] as const),
        producerParams: Object.freeze([
          Object.freeze(["i32", "i32"] as const),
          Object.freeze(["i32", "i32"] as const),
        ] as const),
        producerResults: Object.freeze([
          Object.freeze(["i32"] as const),
          Object.freeze(["i32"] as const),
        ] as const),
        bodySha256:
          "f09a7a12954169ae595d12d870e69a4c0092003157d72523d626d2a3990241e2",
        producerBodySha256: Object.freeze([
          "92df16acc44885ad89dac98578a833d2c5c84b8da8cd1f90367c46428685c05c",
          "d51abe7893b1db5b4f1d212aab9b51901134157766e0c41ead4e1c2b41d08eef",
        ] as const),
        tableNeighbourBodySha256: Object.freeze([
          "f09a7a12954169ae595d12d870e69a4c0092003157d72523d626d2a3990241e2",
          "cb751dd998dc5591fb1a8d05d08d194a8a7e4670b1a9685816b9a2af8fab7980",
        ] as const),
        layout: Object.freeze({
          cursorActiveArt: 0x5a16e0,
          cursorSoftwareModel: 0x5a16e4,
          cursorShowCount: 0x5a16e8,
          cursorColorBuffer: 0x298e50,
          cursorArtHotspot: 0x00,
          cursorArtTexture: 0x0c,
          cursorHandleKey: 0x08,
          cursorHandleObject: 0x00,
          cursorViewTexture: 0x08,
          cursorTextureType: 0x0c,
          cursorTextureWidth: 0x14,
          cursorTextureHeight: 0x18,
        }),
      }),
      // Everything a team apply needs, and nothing else. Kick was sent first,
      // alone, against a live game; the rest joined it once that had worked.
      //
      // The sender, drain and every command builder below are byte-identical to
      // build 38,797, including their signatures and active table relations.
      // That build's live evidence established that opcode 31 with hero id 38
      // removes Devona; the historical pre-Devona `0x26` clear-roster sentinel
      // does not apply. Rebuilds therefore remove observed heroes individually
      // and confirm each publication before adding the saved order.
      //
      targetObservation: Object.freeze({
        layout: Object.freeze({
          manualTargetAgentId: 0x5a394c,
          automaticTargetAgentId: 0x5a3948,
          agentX: 0x74,
          agentY: 0x78,
          agentType: 0x9c,
        }),
      }),
      storage: Object.freeze({
        openExport: "enhancement_open_storage",
        configureExport: "enhancement_configure_storage",
        travel: Object.freeze({
          enqueueExport: "enhancement_travel",
          configureExport: "enhancement_configure_travel",
          // Current GWCA names this kTravel (0x10000183). ChCliMap #16199
          // writes its four scalar arguments to {map, region, language,
          // district} and sends this message through the certified dispatcher.
          messageId: 0x1000_0183,
          producer: Object.freeze({
            functionIndex: 16199,
            params: Object.freeze([
              "i32", "i32", "i32", "i32", "i32",
            ] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "47c2f33dc98226fbb1596d60b2dfe76a9a19f645e94330a0582a6dc50d5be595",
          }),
        }),
        // Chat command parser #13703 receives the complete UTF-16 line and
        // returns one when a slash command was handled. It is the first of
        // the two parsers called by chat submit #13714, before the normal
        // path reports an unknown command.
        slashParser: Object.freeze({
          functionIndex: 13703,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256:
            "156c4345c79e43c20b136fa37581d80a62fcf73cf290cabe308ac259387517df",
        }),
        // ChCliStoc #8978 is the DataWindow handler. Its seven-way branch
        // reads `type` at +4; branch zero reads `agent` at +0 and the two
        // storage unlock bits from `data` at +8, then emits
        // kShowXunlaiChest (0x10000040). The command supplies the same
        // header-stripped { agent: 0, type: 0, data: 3 } payload as the
        // normal server-to-client decoder.
        handler: Object.freeze({
          functionIndex: 8978,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "0a46adca4dd597f9430c23457f6ce6ff7ccdfbdaf4a77b449a8158e2c595189a",
        }),
      }),
      gameThread: Object.freeze({
        // GWCA's `GameThread::Enqueue` hooks this recurring frame callback. Its
        // source anchor is FrApi.cpp's unique `renderElapsed >= 0` assertion;
        // the active table relation below proves this is the registered callback,
        // not the nearby one-time frame/message initializer (#6659).
        drain: Object.freeze({
          functionIndex: 6661,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          tableSlot: 1721,
          bodySha256:
            "9fb1ca0dee40f5ceef3d0174846ef38af47a8366bfe76cb8da12e86419b40c41",
        }),
      }),
      teamApply: Object.freeze({
        thunkExport: "enhancement_command",
        professionTrace: Object.freeze({
          readerExport: "enhancement_profession_trace",
          // The unique sender shared by all 147 packet builders. The trace
          // wrapper records only fixed opcode-65 and opcode-93 payloads and then
          // calls this exact body unchanged.
          sender: Object.freeze({
            functionIndex: 5951,
            params: Object.freeze(["i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "d7f7c74b9cb14ba957ed8de7e74cc18167a3b688301d5f3d765ba04770a8b361",
          }),
        }),
        entries: Object.freeze([
          Object.freeze({
            opcode: 31,
            functionIndex: 6887,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "ad54846e78e293ba4c2a6cef392bb3f3cb62fdd5209d8aadf0e99c75a4914e59",
            label: "CharMsgSendHeroDeactivate(heroId)",
          }),
          Object.freeze({
            opcode: 30,
            functionIndex: 6886,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "709ce8b36ecd5bb269d211d38a7d504a7577e40312be7c74c125f02bbb3be697",
            label: "CharMsgSendHeroActivate(heroId)",
          }),
          Object.freeze({
            opcode: 21,
            functionIndex: 6878,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "e8c9b33da97ad99f4fabcca08fabf29ecb8a08fb400d8e161bba659775234157",
            label: "CharMsgSendCommandAiMode(agentId, behavior)",
          }),
          // The two that carry a payload. Their third and fourth arguments are
          // addresses of buffers the renderer owns and fills; the client copies
          // out of them and sends. See `COMMAND_PAYLOAD_WORDS`.
          Object.freeze({
            opcode: 93,
            functionIndex: 6943,
            params: Object.freeze(["i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "37f53da3c4edecbf9438f093b90e3aff5e65eeac018835da016c472c5fa15a23",
            label: "skillbar set (agentId, count, skills[])",
          }),
          Object.freeze({
            opcode: 65,
            functionIndex: 6917,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "7ea3e38a9cb5dd4bd6edc4d86a89f1e98c531d005b4f3e08a8142b50146f688c",
            label:
              "CharMsgSendOrderSetProfessionSecondary(agentId, profession)",
          }),
          Object.freeze({
            opcode: 16,
            functionIndex: 6873,
            params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "c2b8c55c9cddf538e61911cb6d542196a35700c1d6e5a5e693ab627ca4e53041",
            label: "attributes set (agentId, count, ids[], ranks[])",
          }),
          Object.freeze({
            opcode: 155,
            functionIndex: 10650,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze([] as const),
            bodySha256:
              "99cb42fb99f1503f80beb589f43c7f9bb841352bd95344a7d96f243f0f639287",
            label: "CharMsgSendSetHardMode(enabled)",
          }),
        ] as const),
      }),
      partyObservation: Object.freeze({
        functionIndex: 6842,
        params: Object.freeze(["i32", "i32", "i32"] as const),
        results: Object.freeze([] as const),
        playerChatMessage: 0x1000_0082,
        hideHeroPanelMessage: 0x1000_01a3,
        showHeroPanelMessage: 0x1000_01a4,
        // This is the smallest domain-complete dirty set: two hero-readiness
        // notifications, four distinct map-context lifecycle boundaries, and
        // the four party membership mutations that can replace playerParty or
        // its hero vector. Everything else through #6842 remains a no-op for
        // party traversal and the 120-tick reconciliation is the missed-event
        // recovery path.
        partyDirtyMessages: Object.freeze([
          0x1000_0038, // kHeroAgentAdded
          0x1000_0039, // kHeroDataAdded
          0x1000_008c, // kMapLoaded
          0x1000_0098, // kLoadMapContext
          0x1000_00c2, // kStartMapLoad
          0x1000_0111, // kMapChange
          0x1000_011e, // kPartyAddHero
          0x1000_011f, // kPartyRemoveHero
          0x1000_0124, // kPartyAddPlayer
          0x1000_0126, // kPartyRemovePlayer
        ] as const),
        // ChCliApi #8947 contains three independent kPlayerChatMessage sites;
        // each directly calls #6842. Nearby ChCliApi producers #8942/#8945
        // emit 0x1000007f/0x10000080 to that same dispatcher.
        playerChatProducer: 8947,
        playerChatSites: 3,
        nearbyPlayerMessages: Object.freeze([
          0x1000_007f, 0x1000_0080,
        ] as const),
        nearbyPlayerMessageProducers: Object.freeze([8942, 8945] as const),
        layout: Object.freeze({
          // GameContext -> PartyContext -> current PartyInfo -> heroes Array.
          // Only owned HeroID/AgentID pairs cross the companion ABI.
          partyContext: 0x4c,
          playerParty: 0x54,
          partyHeroes: 0x24,
          heroMemberStride: 0x18,
          heroAgentId: 0x00,
          heroOwnerPlayerId: 0x04,
          heroId: 0x08,
          // Certified live against this build in an outpost, by cross-match
          // against the eight offsets above rather than by plausibility.
          heroLevel: 0x14,
          partyPlayers: 0x04,
          partyHenchmen: 0x14,
          partyFlag: 0x14,
          // GameContext::account and AccountContext::unlocked_account_skills.
          // GWCA exposes this exact array through GetIsSkillUnlocked: one bit per
          // skill id, account-wide and therefore usable by heroes.
          accountContext: 0x28,
          accountUnlockedSkills: 0x124,
          worldContext: 0x2c,
          // Its hero ids *and* agent ids matched the party array exactly.
          worldHeroFlags: 0x584,
          heroFlagStride: 0x24,
          flagHeroId: 0x00,
          flagAgentId: 0x04,
          flagBehavior: 0x0c,
          // The account's unlock table, not the party: its row count held at two
          // across kicking both heroes and re-adding one. `infoAgentId` is zero
          // while a hero is unlocked but out of the party and the live agent id
          // while it is in, so one array answers ownership and membership both.
          worldHeroInfo: 0x594,
          heroInfoStride: 0x9c,
          infoHeroId: 0x00,
          infoAgentId: 0x04,
          infoLevel: 0x08,
          infoPrimary: 0x0c,
          infoSecondary: 0x10,
          // Zero for every non-mercenary observed, as the reference describes. The
          // mercenary rule itself is untestable on an account that owns none, so
          // the kernel publishes mercenaries as *unknown* rather than guessing.
          infoAppearanceBitmap: 0x48,
          worldSkillbars: 0x6f0,
          skillbarStride: 0xbc,
          skillbarAgentId: 0x00,
          skillbarSkills: 0x04,
          skillSlotStride: 0x14,
          skillSlotId: 0x0c,
          skillbarDisabled: 0xa4,
          // Certified live in the same outpost. The stride is proved outright: the
          // words at +0x43c from each row are the next row's agent id. Every real
          // entry satisfies `index == id`, and the set of entries present is each
          // character's primary profession's attributes plus all but one of its
          // secondary's — the one missing is always that secondary's own primary
          // attribute, which no character may invest in. Three rows, three
          // professions pairs, no exception.
          worldAttributes: 0xac,
          attributeStride: 0x43c,
          attributeAgentId: 0x00,
          attributeEntries: 0x04,
          attributeEntryStride: 0x14,
          attributeEntryId: 0x00,
          // `level_base`. `level` at 0x08 adds runes, and a stored build holds the
          // invested rank — Devona reads Strength 7 there and 8 with her rune.
          attributeEntryRank: 0x04,
          // Exact-build initialised `AreaInfo[mapId]`. Cross-checked against
          // GWToolbox++'s flags: Lion's Arch (55) is PvE, Random Arenas (188)
          // carries the PvP bit, and Isle of Wurms (529) the guild-hall bit.
          areaInfo: 0x1cc630,
          areaInfoCount: 883,
          areaInfoStride: 0x7c,
          areaInfoFlags: 0x10,
          worldProfessionStates: 0x6bc,
          professionStateStride: 0x14,
          worldCharacterSkills: 0x710,
        }),
      }),
    }),
  ]);

export function findEnhancementBuild(
  sha256: string,
): KnownEnhancementBuild | null {
  return (
    ENHANCEMENT_BUILDS.find(
      (build) =>
        build.sha256 === sha256 && hasCompleteEnhancementProfileHashes(build),
    ) ?? null
  );
}
