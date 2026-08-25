/**
 * The registry of retained exact-build Enhancement certificates.
 * Certificate structure and validation live in enhancement-build-model.
 */
import {
  hasValidEnhancementProfileHashes,
  type KnownEnhancementBuild,
} from "./enhancement-build-model.js";
export * from "./enhancement-build-model.js";

// Retained regression facts for one reviewed generation. Runtime certification
// never grants a capability from this input hash or its historic output hashes;
// the isolated semantic verifier re-derives every requested fact first.
//
// The input is the template-save client, not the raw official module: that
// transform is the floor every launch lands on, and the Enhancement transform is
// layered on top so opting in never costs template save/load. It only appends
// functions and reserves one new terminal table entry, so the main-loop index,
// original table size and every data address below are certified separately for
// each template-save output. The semantic roles use these reviewed facts as
// evidence or regression expectations, not as a launch allowlist.
export const ENHANCEMENT_BUILDS: readonly KnownEnhancementBuild[] =
  Object.freeze([
    Object.freeze({
      sha256:
        "26a71c3e2bf55ab992dce659c1192213858ee25799daa87841ed23a3ddbb601a",
      // Recomputed from the exact current JSPI artifact when the independent
      // play-region capability landed. The retained output is the complete
      // product profile proved by semantic verifier ABI 6.
      //
      // `pnpm check` cannot catch a stale value here. The transform input is a
      // derived game binary this repository does not contain, so nothing in the
      // suite can run the transform; the first thing that notices is a launch
      // that installs no enhancement at all. Recompute by running
      // `transformEnhancementWasm` against the real derived module whenever
      // ENHANCEMENT_TRANSFORM_ABI or any config word changes.
      outputSha256: Object.freeze({
        "features-601":
          "200341f7bbeb50ab2ab9125a869c7fa61d7b1569d9c760e98acbe026f94ba6bb",
        "features-7ff":
          "c4b31ca957bf5b8d74e97eb8bd8f816cf448bca5d0b8d56f1037bc7a96c4d638",
      }),
      programId: 1,
      // The verifier derives this bounded identity from the exact module; it is
      // diagnostic metadata, never a nearest-build selector.
      buildId: 3_100_397_719,
      hookFunction: 446,
      hookParams: Object.freeze(["i32"] as const),
      hookResults: Object.freeze([] as const),
      hookBodySha256:
        "a4f73b08ad78397b86ff050bfc25a26ab5a8794ae8f914a4b16399253fbf4635",
      // The input table is fixed at 4,683 entries. The transform extends both
      // limits once and owns only this new terminal entry; statically empty input
      // slot 0 is a game runtime sentinel and must remain untouched.
      tableSlot: 4683,
      observationBase: Object.freeze({
        layout: Object.freeze({
          contextRoot: 0x5a0e70,
          agentArray: 0x5a4de8,
          gameContextSlot: 6,
          characterContext: 0x44,
          mapId: 0x198,
          isExplorable: 0x19c,
          currentMapId: 0x234,
          currentInstanceType: 0x23c,
          playerNumber: 0x2ac,
          agentId: 0x2c,
          agentX: 0x74,
          agentY: 0x78,
          agentType: 0x9c,
          agentPlayerNumber: 0xf4,
          agentModelType: 0xf6,
          worldContext: 0x2c,
          // Exact-build initialised `AreaInfo[mapId]`. Cross-checked against
          // GWToolbox++'s flags: Lion's Arch (55) is PvE, Random Arenas (188)
          // carries the PvP bit, and Isle of Wurms (529) the guild-hall bit.
          areaInfo: 0x1cc5c0,
          areaInfoCount: 883,
          areaInfoStride: 0x7c,
          areaInfoFlags: 0x10,
        }),
      }),
      playRegionObservation: Object.freeze({
        layout: Object.freeze({
          contextRoot: 0x5a0e70,
          gameContextSlot: 6,
          characterContext: 0x44,
          mapId: 0x198,
          isExplorable: 0x19c,
          currentMapId: 0x234,
          currentInstanceType: 0x23c,
          playerNumber: 0x2ac,
          areaInfo: 0x1cc5c0,
          areaInfoCount: 883,
          areaInfoStride: 0x7c,
          areaInfoFlags: 0x10,
        }),
      }),
      playerSkillbarObservation: Object.freeze({
        worldLifecycle: Object.freeze({ functionIndex: 8812, params: ["i32"] as const, results: ["i32"] as const, bodySha256: "b0109c7c853a7d01586172aef66ab14f4d192fbe4f5ea7514553e0821d0dcb5a" }),
        update: Object.freeze({ functionIndex: 8698, params: [] as const, results: [] as const, bodySha256: "c72cdcbdae22e520f42edbcf2fd56545bad7a014b078ed77ebd284181f523d61" }),
        rowReader: Object.freeze({ functionIndex: 8701, params: ["i32", "i32", "i32"] as const, results: ["i32"] as const, bodySha256: "7b8b5c65a126fae2edfa517a4706244a0d2352c628fde208d049ecf82dfa4e72" }),
        slotReader: Object.freeze({ functionIndex: 8702, params: ["i32", "i32", "i32"] as const, results: ["i32"] as const, bodySha256: "ee41be1f4dcaf8e5822fc024e41cbbad74cf293cdafb2b89a8691aeb680e68b5" }),
        coreLayout: Object.freeze({ worldSkillbars: 0x6f0, skillbarStride: 0xbc, skillbarAgentId: 0, skillbarSkills: 4, skillSlotStride: 0x14 }),
        partyLayout: Object.freeze({ skillSlotId: 0x0c, skillbarDisabled: 0xa4 }),
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
          "deada48f4c9ce0b2046f7ab9d416f530c87d24ca0e3fb905f5874abad3e92c41",
          "2988a05e1a39c1f32f564f5afecf9a4b172a27120c9a9a791ca980804a285100",
        ] as const),
        tableNeighbourBodySha256: Object.freeze([
          "f09a7a12954169ae595d12d870e69a4c0092003157d72523d626d2a3990241e2",
          "cb751dd998dc5591fb1a8d05d08d194a8a7e4670b1a9685816b9a2af8fab7980",
        ] as const),
        layout: Object.freeze({
          cursorActiveArt: 0x5a1670,
          cursorSoftwareModel: 0x5a1674,
          cursorShowCount: 0x5a1678,
          cursorColorBuffer: 0x298de0,
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
          manualTargetAgentId: 0x5a38dc,
          automaticTargetAgentId: 0x5a38d8,
        }),
      }),
      uiDispatcher: Object.freeze({
        functionIndex: 6842,
        params: Object.freeze(["i32", "i32", "i32"] as const),
        results: Object.freeze([] as const),
        bodySha256:
          "ba41a2237bc91373cdee67ad8cfff700b80a2e351b7e980f37d68690307de4c0",
        playerChatMessage: 0x1000_0082,
        hideHeroPanelMessage: 0x1000_01a3,
        showHeroPanelMessage: 0x1000_01a4,
      }),
      xunlaiAction: Object.freeze({
        openExport: "enhancement_open_storage",
        configureExport: "enhancement_configure_storage",
        // Originally measured on build 38,833 and re-verified against this
        // exact current client. The readers below
        // independently prove WorldContext::players at +0x80c, Array size at
        // +8, 0x50-byte records, and the three fields used by the kernel.
        accessProof: Object.freeze({
          layout: Object.freeze({
            worldPlayers: 0x80c,
            playerRecordStride: 0x50,
            playerRecordAgentId: 0x00,
            playerRecordAccessFlags: 0x34,
            playerRecordNumber: 0x38,
            areaInfoType: 0x08,
          }),
          readers: Object.freeze({
            "agent-id": Object.freeze({
              functionIndex: 8939,
              params: Object.freeze(["i32"] as const),
              results: Object.freeze(["i32"] as const),
              bodySha256:
                "9232ecf44778323dd0d1f922fbd1d39b3f75d7425886a44019df79f2cf87f93a",
            }),
            "access-flags": Object.freeze({
              functionIndex: 9196,
              params: Object.freeze(["i32"] as const),
              results: Object.freeze(["i32"] as const),
              bodySha256:
                "53fb1be960d2e79c441dd2c29276020cb9a834630fce5a3686035885ca508d29",
            }),
            "player-number": Object.freeze({
              functionIndex: 9205,
              params: Object.freeze(["i32"] as const),
              results: Object.freeze(["i32"] as const),
              bodySha256:
                "b98af3eb50f4c2aa1bc09f0a88712e32a2a14fe0d013126e1e4c0e842008e01f",
            }),
          }),
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
      travelAction: Object.freeze({
        enqueueExport: "enhancement_travel",
        configureExport: "enhancement_configure_travel",
        toggleExport: "enhancement_take_travel_toggle",
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
        // Regression expectation only. Runtime authority re-derives this unique
        // current-district role and all of its call/content relationships.
        contextResolver: Object.freeze({
          functionIndex: 11650,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "309615106e62d04390ca11f88b28d15e04494d9e850c0f5ebff8548f098ba062",
        }),
      }),
      chatAliases: Object.freeze({
        // Parser #13703 receives the complete UTF-16 line and returns one
        // only when an alias was handled; normal chat remains the fallback.
        parser: Object.freeze({
          functionIndex: 13703,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256:
            "fcff05250c935e92337fee53cd9f086b22d1ba02a4ff051bd94165f61833a713",
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
            "a3bf3e37cc469f8a0b220fcbb857078fbf427c304f0c07496694d506f5c396d0",
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
              "4746b06f47ce79df6a3879b0b55d6d6430b65544479f4109ca84a56a12738a36",
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
        nearbyPlayerMessageProducers: Object.freeze([7880, 8945] as const),
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
          // AccountContext is independently registered in context slot 10.
          // Using that slot avoids trusting a copied GameContext pointer offset.
          accountContextSlot: 10,
          accountUnlockedSkills: 0x124,
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
          worldProfessionStates: 0x6bc,
          professionStateStride: 0x14,
          worldCharacterSkills: 0x710,
        }),
      }),
      skillSlotGeometry: Object.freeze({
        initializer: Object.freeze({
          functionIndex: 15744,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "e4b1af23a4efcbb7fd1c484c4168553c91df5df7e1e40a65ff31bb4ca10790e1",
          constructorCallOperand: 2186,
        }),
        constructor: Object.freeze({
          functionIndex: 6676,
          params: Object.freeze([
            "i32", "i32", "i32", "i32", "i32", "i32",
          ] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256:
            "a29fca1d30e5fa7dea1ca30f6453acbb8a099e4423c1f05ee43b01cfc3045c41",
        }),
        labelAddress: 0x186e1a,
        layout: Object.freeze({
          frameArray: 0x5a1fdc,
          frameCount: 0x5a1fe4,
          frameBytes: 0x1c8,
          frameChildOffsetId: 0xb8,
          frameId: 0xbc,
          framePositionFlags: 0xd8,
          frameViewportWidth: 0x104,
          frameViewportHeight: 0x108,
          frameScreenLeft: 0x10c,
          frameScreenBottom: 0x110,
          frameScreenRight: 0x114,
          frameScreenTop: 0x118,
          frameRelation: 0x128,
          frameState: 0x18c,
        }),
      }),
      preGameControls: Object.freeze({
        hashFunction: Object.freeze({
          functionIndex: 365,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256:
            "90e009c029d1a6fb53f0e7b92d72583497455266a64841d34ac56905289ac95b",
        }),
        labels: Object.freeze({
          play: 0x1765ea,
          selector: 0x1766c8,
          yes: 0x176972,
          no: 0x176980,
          reconnectDialog: 0x1769c4,
        }),
        labelHashes: Object.freeze({
          play: 0x0b041d2a,
          selector: 0x31616b12,
          yes: 0x535d1967,
          no: 0xd698c3c1,
          reconnectDialog: 0xfa61451e,
        }),
        layout: Object.freeze({
          frameArray: 0x5a1fdc,
          frameCount: 0x5a1fe4,
          frameBytes: 0x1c8,
          frameId: 0xbc,
          frameHashId: 0x134,
          frameState: 0x18c,
          contextRoot: 0x5a0e70,
          gameContextSlot: 6,
          characterContext: 0x44,
          currentInstanceType: 0x23c,
        }),
      }),
      skillCooldownObservation: Object.freeze({
        // #8704 is the unique bounded Skillbar row/slot reader. It reads the
        // recharge timestamp and subtracts the precise timer returned by #249.
        reader: Object.freeze({
          functionIndex: 8704,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256:
            "de894c4032f9c9cf7a50a8f36ad1174446ead7246bf9ae830f43d8e45eb0d697",
          timerCallOperand: 200,
        }),
        timer: Object.freeze({
          functionIndex: 249,
          params: Object.freeze([] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256:
            "f2b448b590efb575ca868617b0a41d544971b29ecec04a69247f3a2f7210e773",
        }),
        layout: Object.freeze({
          // Skillbar::skills starts at +4. The reader's total row offset is
          // +12, so the timestamp is +8 inside each 0x14-byte slot.
          skillSlotRecharge: 0x08,
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
        build.sha256 === sha256 && hasValidEnhancementProfileHashes(build),
    ) ?? null
  );
}
