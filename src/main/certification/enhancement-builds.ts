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
        "484f7f20691c912c372b7e265a1cc4a4d26b37bfbd52c838b3137d5f29b67d3b",
      // Recomputed from the exact current JSPI artifact when the independent
      // play-region capability landed. The retained output is the complete
      // product profiles proved by the current semantic verifier.
      //
      // `pnpm check` cannot catch a stale value here. The transform input is a
      // derived game binary this repository does not contain, so nothing in the
      // suite can run the transform; the first thing that notices is a launch
      // that installs no enhancement at all. Recompute by running
      // `transformEnhancementWasm` against the real derived module whenever
      // ENHANCEMENT_TRANSFORM_ABI or any config word changes.
      outputSha256: Object.freeze({
        "features-601":
          "01fbd2857f9df5456237f1182c898d2edc541e438018d08b6fd85edc1223da99",
        "features-e01":
          "134becd3f6dab64df1b7db6a19a008981fc8f1bf4d187e2a27571e892e8c302c",
        "features-fff":
          "8de1f98f1bab9478f757908a8f9139937555aa704a387a8f8a09d537cff5604d",
        "features-1fff":
          "ba0d15ac088c13ab97d1b8675e685bc87c5698e6461372c3933f72c710ed6ea3",
        "features-2fff":
          "24d891930002b81435c9faae86dc84ecc54c2b33036b1be1bb00065c71bab836",
        "features-3fff":
          "fd88cc4f63af870026e3e12399b602dc79a8a7ab97f399cdb1151f58c446a605",
      }),
      programId: 1,
      // The verifier derives this bounded identity from the exact module; it is
      // diagnostic metadata, never a nearest-build selector.
      buildId: 514_880_306,
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
          characterUuid: 0x64,
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
          characterUuid: 0x64,
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
        guildHall: Object.freeze({
          enqueueExport: "enhancement_guild_hall",
          // The client's guild command chooses Leave while AreaInfo type is
          // GuildHall (4); otherwise it sends the current guild's 16-byte key.
          enterMessageId: 0x1000_0180,
          leaveMessageId: 0x1000_0182,
          layout: Object.freeze({ guildContextSlot: 15, guildHallKey: 0x64 }),
          keyAccessor: Object.freeze({
            functionIndex: 7960,
            params: Object.freeze([] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "f78d0067879c110a5269ab57eaab946525cbc0a7ba09ff02c150db94d5176598",
          }),
          areaTypeAccessor: Object.freeze({
            functionIndex: 9531,
            params: Object.freeze([] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "6b1546fa7e04a8f3642c4d5a0daa0d9d58255a879d47965920615013f465172f",
          }),
          producer: Object.freeze({
            functionIndex: 15462,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "ff6bcc8db69cbb7fddc17af6d4b7a4c052cb6cd17e335155db495c2e435290c9",
          }),
        }),
        // WorldContext::unlocked_map is not accepted from GWCA's struct.
        // Accessor #9184 returns the exact Array<u32> at +0x60c, while the
        // official map consumer #15978 proves word=map/32 and bit=map%32.
        unlockProof: Object.freeze({
          layout: Object.freeze({ worldUnlockedMaps: 0x60c }),
          accessor: Object.freeze({
            functionIndex: 9184,
            params: Object.freeze([] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "24579d9f602bc21a37c0dc8ca88c362a38493c64d101d42081ccd6ed5314f975",
          }),
          consumer: Object.freeze({
            functionIndex: 15978,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "c462fd76a759a90c48dc9298223cf6f571dec8ef11c732177faa14ac4b49fb9f",
          }),
        }),
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
      chatFiltering: Object.freeze({
        writeToChatLogMessage: 0x1000_007f,
        packetChannelOffset: 0,
        packetMessageOffset: 4,
        allyDropTemplate: 0x07f1,
        numericSegment: 0x010f,
        encodedNumberBase: 0x0100,
        // Encoded-name markers consumed by the native chat path.
        playerNameToken: 0x0ba9,
        encodedStringStart: 0x0107,
        encodedStringEnd: 0x0001,
        maxPlayerNameUnits: 20,
        // Fixed UTF-16 CharContext::player_name[20]. The adjacent UUID and
        // player-number fields are owned by the shared observation layout.
        currentPlayerNameOffset: 0x74,
        systemPrefix: 0x8102,
        hallOfHeroesTemplate: 0x223b,
        titleTemplates: Object.freeze([
          0x1443, 0x23e2, 0x23e5, 0x23e6,
        ] as const),
        producer: Object.freeze({
          functionIndex: 7880,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256:
            "27de9130f902e343143030751962177d77853da9e841eb7afbfd3c6c494e556d",
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
        characterSwitchAction: Object.freeze({
          enqueueExport: "enhancement_character_action",
          configureExport: "enhancement_configure_character_action",
          logoutMessageId: 0x1000_009d,
          frameDispatchOffset: 0xa8,
          frameChild: Object.freeze({
            functionIndex: 6796,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "9f73f1018d0bf99fd0d16b6ede0921dbe29cf70a4da4a61c9b24c1e68dbb0bf0",
          }),
          frameParent: Object.freeze({
            functionIndex: 6797,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "46c90817c6ab335d5b8d57fdc1e38abd146c2b123dd8dcf0f08aca8245b8a9f2",
          }),
          frameResolver: Object.freeze({
            functionIndex: 6534,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "f0d5e7c4c71f920541037b1225613e334e2476723a427cab5c2688538265eb47",
          }),
          frameDispatch: Object.freeze({
            functionIndex: 6508,
            params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "ccf496f855fa579dac0d1ea86b95b6a6db21104d2a41b1d03c6bd213ee26ca7e",
          }),
          logoutProducer: Object.freeze({
            functionIndex: 12434,
            params: Object.freeze(["i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "b618abba3579ffe6f149a23e2550f6b86571b0f3beaa30acea059153f7cd6b06",
          }),
        }),
        characterListLayout: Object.freeze({
          characterArrayPointer: 0x5a75e8,
          characterArrayCount: 0x5a75f0,
          selectedCharacterName: 0x5a7760,
        }),
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
          frameChildOffsetId: 0xb8,
          frameId: 0xbc,
          frameHashId: 0x134,
          frameRelation: 0x128,
          frameState: 0x18c,
          contextRoot: 0x5a0e70,
          gameContextSlot: 6,
          characterContext: 0x44,
          characterUuid: 0x64,
          currentInstanceType: 0x23c,
        }),
      }),
      quickItemMove: Object.freeze({
        moveItemMessageId: 0x1000_01af,
        configureExport: "enhancement_configure_quick_item_move",
        modifierExport: "enhancement_quick_item_move_modifiers",
        inventorySlot: Object.freeze({
          // GWCA's current Wasm scanner names this exact target
          // InventoryBag_UICallback_Func.
          functionIndex: 14956,
          params: ["i32", "i32", "i32"] as const,
          results: [] as const,
          bodySha256: "eb94c3a6a02a1df3ee09724a20c1203fd3d973cd933b098ee4fd2b6a91403a4d",
        }),
        materialStorageSlot: Object.freeze({
          functionIndex: 14994,
          params: ["i32", "i32", "i32"] as const,
          results: [] as const,
          bodySha256: "7cf0967a3e5f3f785087f32415386eb424bb5ee54ade0cc70ba42c8d7fc799ea",
        }),
        numberPreference: Object.freeze({
          functionIndex: 10807,
          params: ["i32"] as const,
          results: ["i32"] as const,
          bodySha256: "6bbf1281e9b949a76d31595dddf1f95f6eae8de0f2129214e0ccb059cb46d1e9",
        }),
        timer: Object.freeze({
          functionIndex: 249,
          params: [] as const,
          results: ["i32"] as const,
          bodySha256: "c1f93ac7e783305bff7d976dbf55365b67fa6696243305685aa1fb0fb7901030",
        }),
        // GmItemHelpers.cpp: ItemCliValidate(sourceItemId), followed by
        // quantity, bag-index and slot validation. GWCA MoveItem_Func.
        moveItem: Object.freeze({
          functionIndex: 13640,
          params: ["i32", "i32", "i32", "i32"] as const,
          results: [] as const,
          bodySha256: "12b11795227c8ca7ea284798a22fa350234a6d0330fe222caab8b895ffde98e5",
        }),
        storageFrameHash: 0x8a02_f1b2,
        tradeCartFrameHash: 0x72f7_171f,
        tradeDialogFrameHash: 0xbea6_724c,
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
    // October facts retain the complete independently checked main feature set.
    // Exact item/trade fields keep the Quick Item Move input guard.
    Object.freeze({
      sha256: "b5f10d50833ed9390ce4faa49fb9a8c009416989e07f20690c27b39b5ef048ad",
      outputSha256: Object.freeze({
        "features-fffff": "8ca301bb9ca8f7dd2fab32719548f4603f7946aed6b841d5e8b8fedceb396801",
        "features-01": "4fd40b09523895ea8a387b0a82486e5ab36d28d9e2807499c8536946570cc4fa",
        "features-e01": "e30d26a86f7377dad91a0b86744cf003cffc5777b267cff11c9acc5438cee9b2",
        "features-601": "6a37e02ad48a9f13945954c2871766b3394eb995d5b660605b34ee54f1a86eab",
        "features-200": "fdcc9ed6b41d77aedd20c58591e0222b30e59f0cfdc1588304e1b3d313995e0b",
        "features-202": "fd87adcebce8ff32d1f36e82e527c682c20333455fda0a7ea46114fd752061be",
        "features-284": "a7d0a66dad19f05e2e1cb6b84dd2a6cd7ac7851e5aa55059e31c08b4a512b64f",
        "features-285": "2d56460ecc76f4eb9993eb81391e09e1022a2291c5c41ec523576006c794608d",
        "features-270": "56802eb209fb1f4e3e225057015a2796eba73d2b8001a2ee41dd17f3e8c5f6bf",
        "features-2fc": "cf3bc0632be4749a46b0b0d76ed7c44180d37f59aed8039bb0d0cb1cc75ebe5a",
        "features-c200": "e072080394957aee191c66658b3bc9bcf35d8e1ca03e7a11e274bae211644268",
        "features-c204": "8b8556e7697d751d3ef1232cbcb389b9968fc7462cd7661bf43c48122350ff9a",
      }),
      programId: 1,
      buildId: 644569738,
      hookFunction: 446,
      hookParams: Object.freeze(["i32"] as const),
      hookResults: Object.freeze([] as const),
      hookBodySha256: "3318dc0a3af5352870ee4382ad46c12b36e9fecf25205425461e060e4aab66fc",
      tableSlot: 4698,
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
        bodySha256: "f09a7a12954169ae595d12d870e69a4c0092003157d72523d626d2a3990241e2",
        producerBodySha256: Object.freeze(["35fe49f08a02658bc552e7e32ec59c70d103ca235c5379662b570a4df51dcc10", "1007e04530666176638cee41535cc044fea62c300818ab85aacca3cdde5d9176"] as const),
        tableNeighbourBodySha256: Object.freeze(["f09a7a12954169ae595d12d870e69a4c0092003157d72523d626d2a3990241e2", "cb751dd998dc5591fb1a8d05d08d194a8a7e4670b1a9685816b9a2af8fab7980"] as const),
        layout: Object.freeze({
          cursorActiveArt: 5920896,
          cursorSoftwareModel: 5920900,
          cursorShowCount: 5920904,
          cursorColorBuffer: 2740208,
          cursorArtHotspot: 0,
          cursorArtTexture: 12,
          cursorHandleKey: 8,
          cursorHandleObject: 0,
          cursorViewTexture: 8,
          cursorTextureType: 12,
          cursorTextureWidth: 20,
          cursorTextureHeight: 24,
        }),
      }),
      observationBase: Object.freeze({
        layout: Object.freeze({
          contextRoot: 5918848,
          gameContextSlot: 6,
          characterContext: 68,
          characterUuid: 100,
          mapId: 408,
          isExplorable: 412,
          currentMapId: 564,
          currentInstanceType: 572,
          playerNumber: 688,
          areaInfo: 1892352,
          areaInfoCount: 883,
          areaInfoStride: 124,
          areaInfoFlags: 16,
          agentArray: 5935096,
          agentId: 44,
          agentX: 116,
          agentY: 120,
          agentType: 156,
          agentPlayerNumber: 244,
          agentModelType: 246,
          worldContext: 44,
        }),
      }),
      playRegionObservation: Object.freeze({
        layout: Object.freeze({
          contextRoot: 5918848,
          gameContextSlot: 6,
          characterContext: 68,
          characterUuid: 100,
          mapId: 408,
          isExplorable: 412,
          currentMapId: 564,
          currentInstanceType: 572,
          playerNumber: 688,
          areaInfo: 1892352,
          areaInfoCount: 883,
          areaInfoStride: 124,
          areaInfoFlags: 16,
        }),
      }),
      targetObservation: Object.freeze({
        layout: Object.freeze({
          manualTargetAgentId: 5929708,
          automaticTargetAgentId: 5929704,
        }),
      }),
      uiDispatcher: Object.freeze({
        functionIndex: 6842,
        params: Object.freeze(["i32", "i32", "i32"] as const),
        results: Object.freeze([] as const),
        bodySha256: "985cae0fcf4d60ed66513ee6973a6dc3afb11cdccc57f2e9467e020279047d20",
        playerChatMessage: 268435586,
        hideHeroPanelMessage: 268435878,
        showHeroPanelMessage: 268435879,
      }),
      whisperChat: Object.freeze({
        functionIndex: 7879,
        params: Object.freeze(["i32", "i32"] as const),
        results: Object.freeze([] as const),
        bodySha256: "3947df1c888113fe94a12fea2f3d500387b71f2e56b8ddf970d571621248b584",
      }),
      resignAction: Object.freeze({
        functionIndex: 7879,
        params: Object.freeze(["i32", "i32"] as const),
        results: Object.freeze([] as const),
        bodySha256: "3947df1c888113fe94a12fea2f3d500387b71f2e56b8ddf970d571621248b584",
      }),
      gameThread: Object.freeze({
        drain: Object.freeze({
          functionIndex: 6661,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          tableSlot: 1721,
          bodySha256: "97cf36fad18be74e2e9a153cf85e4dc64fc7ca9c741887bf6ccd204726bb3de8",
        }),
      }),
      travelAction: Object.freeze({
        enqueueExport: "enhancement_travel",
        configureExport: "enhancement_configure_travel",
        toggleExport: "enhancement_take_travel_toggle",
        messageId: 268435846,
        producer: Object.freeze({
          functionIndex: 16231,
          params: Object.freeze(["i32", "i32", "i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "e224119860e7616256c5e74d92d2e2fac124dde9c3c3217dc3feccdd0615f39b",
        }),
        contextResolver: Object.freeze({
          functionIndex: 11661,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "4316bdd74d3766f19d7f8c4288b06f5192866686921f1661edc3a3590cbf3297",
        }),
        unlockProof: Object.freeze({
          layout: Object.freeze({
            worldUnlockedMaps: 1548,
          }),
          accessor: Object.freeze({
            functionIndex: 9191,
            params: Object.freeze([] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "24579d9f602bc21a37c0dc8ca88c362a38493c64d101d42081ccd6ed5314f975",
          }),
          consumer: Object.freeze({
            functionIndex: 16010,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "783f07589bd1261921b9bc8f80f3e517450d4fa504a7f213beb2e3ddd694dae9",
          }),
        }),
        guildHall: Object.freeze({
          enqueueExport: "enhancement_guild_hall",
          enterMessageId: 268435843,
          leaveMessageId: 268435845,
          layout: Object.freeze({
            guildContextSlot: 15,
            guildHallKey: 100,
          }),
          keyAccessor: Object.freeze({
            functionIndex: 7964,
            params: Object.freeze([] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "f78d0067879c110a5269ab57eaab946525cbc0a7ba09ff02c150db94d5176598",
          }),
          areaTypeAccessor: Object.freeze({
            functionIndex: 9542,
            params: Object.freeze([] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "f405d7b00e65454a318152154a1bf02744fdbdd61c4ec7da800650aab8d2e2aa",
          }),
          producer: Object.freeze({
            functionIndex: 15487,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "fab247e15279c61c5783bc16f6c02cbf411b3056979f6a765b61763e52bc7d87",
          }),
        }),
      }),
      xunlaiAction: Object.freeze({
        openExport: "enhancement_open_storage",
        configureExport: "enhancement_configure_storage",
        accessProof: Object.freeze({
          layout: Object.freeze({
            worldPlayers: 2060,
            playerRecordStride: 80,
            playerRecordAgentId: 0,
            playerRecordAccessFlags: 52,
            playerRecordNumber: 56,
            areaInfoType: 8,
          }),
          readers: Object.freeze({
            "agent-id": Object.freeze({
              functionIndex: 8945,
              params: Object.freeze(["i32"] as const),
              results: Object.freeze(["i32"] as const),
              bodySha256: "5b816ccbcecb08a28d003eb51df03c33478e6a92e4d874168c1315a8f5f091ae",
            }),
            "access-flags": Object.freeze({
              functionIndex: 9203,
              params: Object.freeze(["i32"] as const),
              results: Object.freeze(["i32"] as const),
              bodySha256: "333132534dcbd28aa53aa5946299455b4b7988ee49895a783765fbce9ba9b2fc",
            }),
            "player-number": Object.freeze({
              functionIndex: 9212,
              params: Object.freeze(["i32"] as const),
              results: Object.freeze(["i32"] as const),
              bodySha256: "0497a06f8d44c263df830a0981f78241df478d7466984fa621e2f390591625fe",
            }),
          }),
        }),
        handler: Object.freeze({
          functionIndex: 8984,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "0a46adca4dd597f9430c23457f6ce6ff7ccdfbdaf4a77b449a8158e2c595189a",
        }),
      }),
      chatAliases: Object.freeze({
        parser: Object.freeze({
          functionIndex: 13720,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "f924982b0a2702c7c7ea6150b9c9f80a5a886c0da04610a17e08f84330cf14e0",
        }),
      }),
      chatFiltering: Object.freeze({
        writeToChatLogMessage: 268435583,
        packetChannelOffset: 0,
        packetMessageOffset: 4,
        allyDropTemplate: 2033,
        numericSegment: 271,
        encodedNumberBase: 256,
        playerNameToken: 2985,
        encodedStringStart: 263,
        encodedStringEnd: 1,
        maxPlayerNameUnits: 20,
        currentPlayerNameOffset: 116,
        systemPrefix: 33026,
        hallOfHeroesTemplate: 8763,
        titleTemplates: Object.freeze([5187, 9186, 9189, 9190] as const),
        producer: Object.freeze({
          functionIndex: 7884,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "af39ac84af3f910dea532421a1d27a77621d13caf6894de83b62ccf9c56841b7",
        }),
      }),
      // The producer's `chat.valid-message` call (TextValidateCoded). Local chat
      // lines call it first: the producer asserts on any line it rejects.
      chatPrint: Object.freeze({
        validator: Object.freeze({
          functionIndex: 5881,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "1f58a402e2b2807caee4c761a61f62b060ea2c65af33eee7530f2191c727cf34",
        }),
      }),
      partyObservation: Object.freeze({
        partyDirtyMessages: Object.freeze([268435512, 268435513, 268435596, 268435608, 268435650, 268435729, 268435743, 268435744, 268435749, 268435751] as const),
        playerChatProducer: 8953,
        playerChatSites: 3,
        nearbyPlayerMessages: Object.freeze([268435583, 268435584] as const),
        nearbyPlayerMessageProducers: Object.freeze([7884, 8951] as const),
        layout: Object.freeze({
          partyContext: 76,
          playerParty: 84,
          partyHeroes: 36,
          heroMemberStride: 24,
          heroAgentId: 0,
          heroOwnerPlayerId: 4,
          heroId: 8,
          heroLevel: 20,
          partyPlayers: 4,
          partyHenchmen: 20,
          partyFlag: 20,
          accountContextSlot: 10,
          accountUnlockedSkills: 292,
          worldHeroFlags: 1412,
          heroFlagStride: 36,
          flagHeroId: 0,
          flagAgentId: 4,
          flagBehavior: 12,
          worldHeroInfo: 1428,
          heroInfoStride: 156,
          infoHeroId: 0,
          infoAgentId: 4,
          infoLevel: 8,
          infoPrimary: 12,
          infoSecondary: 16,
          infoAppearanceBitmap: 72,
          worldAttributes: 172,
          attributeStride: 1084,
          attributeAgentId: 0,
          attributeEntries: 4,
          attributeEntryStride: 20,
          attributeEntryId: 0,
          attributeEntryRank: 4,
          worldProfessionStates: 1724,
          professionStateStride: 20,
          worldCharacterSkills: 1808,
        }),
      }),
      preGameControls: Object.freeze({
        characterSwitchAction: Object.freeze({
          enqueueExport: "enhancement_character_action",
          configureExport: "enhancement_configure_character_action",
          logoutMessageId: 268435613,
          frameDispatchOffset: 168,
          frameChild: Object.freeze({
            functionIndex: 6796,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "9f73f1018d0bf99fd0d16b6ede0921dbe29cf70a4da4a61c9b24c1e68dbb0bf0",
          }),
          frameParent: Object.freeze({
            functionIndex: 6797,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "47471cef99aa5e8df678cddb7a7340e4ef1ad05c9a67f6ab90ed61875a910c71",
          }),
          frameResolver: Object.freeze({
            functionIndex: 6534,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze(["i32"] as const),
            bodySha256: "301a8efed6754a3e028730d5231b5bf2f46155b421d05156df3d84efc83f347c",
          }),
          frameDispatch: Object.freeze({
            functionIndex: 6508,
            params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "be12956994b9607a74d0ec3fb9a8cb0fadda23e57f5e9d2f1b80c9eb333e4513",
          }),
          logoutProducer: Object.freeze({
            functionIndex: 12445,
            params: Object.freeze(["i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "c28e4801b717aaafddcd99305edf49aa938fd6e9adb19829a60a22e6215db435",
          }),
        }),
        characterListLayout: Object.freeze({
          characterArrayPointer: 5938360,
          characterArrayCount: 5938368,
          selectedCharacterName: 5938736,
        }),
        hashFunction: Object.freeze({
          functionIndex: 365,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "b8ede3a030d6dbe916834d24b05d2a1d1e90c77bbf992e38ecfef314f36a328c",
        }),
        labels: Object.freeze({
          play: 1533534,
          selector: 1533756,
          yes: 1534456,
          no: 1534470,
          reconnectDialog: 1534538,
        }),
        labelHashes: Object.freeze({
          play: 184818986,
          selector: 828467986,
          yes: 1398610279,
          no: 3600335809,
          reconnectDialog: 4200678686,
        }),
        layout: Object.freeze({
          frameArray: 5923308,
          frameCount: 5923316,
          frameBytes: 456,
          frameChildOffsetId: 184,
          frameId: 188,
          frameHashId: 308,
          frameRelation: 296,
          frameState: 396,
          contextRoot: 5918848,
          gameContextSlot: 6,
          characterContext: 68,
          characterUuid: 100,
          currentInstanceType: 572,
        }),
      }),
      quickItemMove: Object.freeze({
        moveItemMessageId: 268435890,
        configureExport: "enhancement_configure_quick_item_move",
        modifierExport: "enhancement_quick_item_move_modifiers",
        inventorySlot: Object.freeze({
          functionIndex: 14969,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "3f2b4737ff5bafd92c4723b6af01bab17dfeec37dd1231f8e57e5a77b232ced9",
        }),
        materialStorageSlot: Object.freeze({
          functionIndex: 15007,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "a3cae36158be7402866966983819f8d4d75d351f025387edf57e48f9cbefc98e",
        }),
        numberPreference: Object.freeze({
          functionIndex: 10818,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "b5d5d16dc7b5d81d18e4fdc9025b7cb3cf319f89f71a9f23e067247656c74b15",
        }),
        moveItem: Object.freeze({
          functionIndex: 13651,
          params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "0d2e4de568c40bfc132cbb4f7d100a695daaec2ef58019203d4db4a370de66a0",
        }),
        timer: Object.freeze({
          functionIndex: 249,
          params: Object.freeze([] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "20aad705e846ffd764f7de00845f7767b080329264e2526480ddb6d9d02df259",
        }),
        storageFrameHash: 2315448754,
        tradeCartFrameHash: 1928795935,
        tradeDialogFrameHash: 3198579276,
      }),
      playerEffectObservation: Object.freeze({
        accessors: Object.freeze([
          Object.freeze({
            functionIndex: 8911,
            params: Object.freeze(["i32", "i32", "i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "8bbf0be7d8031c7a3ebb9a6d9311d4849f120352bd61e0a1abfc02735107686c",
          }),
          Object.freeze({
            functionIndex: 8912,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "d420d0eabfb51b9ecdb930d532f282b101febd003fffd8c993ebc9fdcd4dd33b",
          }),
          Object.freeze({
            functionIndex: 8913,
            params: Object.freeze(["i32", "i32", "i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "4737741bf201a48b379bbee09bc56731be209b5c886c4215c42bf8c3dc9abd88",
          }),
          Object.freeze({
            functionIndex: 8914,
            params: Object.freeze(["i32", "i32", "i32", "i32", "f32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "fc2afe3ac91e845eae941170a63964156daad419c4d82d54e17227b694bac250",
          }),
          Object.freeze({
            functionIndex: 8915,
            params: Object.freeze(["i32", "i32", "i32", "f32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "9a39085dfb13220e6f834ec96f99df624116e8a207c57c07f22466705530c5e8",
          }),
          Object.freeze({
            functionIndex: 8916,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "72adab1b90ab319ebf714722d199675dabdbf945affaabecabaa215cbcb858ac",
          }),
        ] as const),
        mutations: Object.freeze({
          addTimed: Object.freeze({
            functionIndex: 7210,
            bodySha256: "af1e0115d7251d12cc1ffe344d00d89f667c914b2cf7820bd2b8faca28e3c3a2",
          }),
          renewTimed: Object.freeze({
            functionIndex: 7211,
            bodySha256: "b63732a3016e26c6785f1e8e3f8c7391f163c4dba7c43e8fdd097a5549a77894",
          }),
          remove: Object.freeze({
            functionIndex: 7212,
            bodySha256: "5e0ab6365510501ff760de8c3bdfb8682bf918e092d9263441d8fc7f56403533",
          }),
        }),
        timer: Object.freeze({
          functionIndex: 249,
          params: Object.freeze([] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "20aad705e846ffd764f7de00845f7767b080329264e2526480ddb6d9d02df259",
        }),
        dirtyMessages: Object.freeze([268435541, 268435542, 268435543, 268435778] as const),
        layout: Object.freeze({
          worldPartyEffects: 1288,
          agentEffectsStride: 36,
          agentEffectsAgentId: 0,
          agentEffectsEffects: 20,
          effectStride: 24,
          effectSkillId: 0,
          effectAttributeLevel: 4,
          effectId: 8,
          effectMaintainerAgentId: 12,
          effectDuration: 16,
          effectTimestamp: 20,
        }),
      }),
      effectIconGeometry: Object.freeze({
        frameHash: 1726357791,
        initializer: Object.freeze({
          functionIndex: 14292,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "da295c351454465ef69d27ca0eea9cec827c779767eb55db8093fba71b34da44",
          constructorCallOperand: 168,
        }),
        constructor: Object.freeze({
          functionIndex: 6676,
          params: Object.freeze(["i32", "i32", "i32", "i32", "i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "501d4e22c342f594bebc1ade8b6280b369160c488e3b6f7b4ff40fe86ed01aca",
        }),
        childBuilder: Object.freeze({
          functionIndex: 14320,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "1a93ec1b273d42e3af7c36ecfd2737dd1537cc47c47671a576f66df01e2c0ca2",
          childOffset: 4,
        }),
        layout: Object.freeze({
          frameArray: 5923308,
          frameCount: 5923316,
          frameBytes: 456,
          frameChildOffsetId: 184,
          frameId: 188,
          framePositionFlags: 216,
          frameViewportWidth: 260,
          frameViewportHeight: 264,
          frameScreenLeft: 268,
          frameScreenBottom: 272,
          frameScreenRight: 276,
          frameScreenTop: 280,
          frameRelation: 296,
          frameState: 396,
        }),
      }),
      alcoholObservation: Object.freeze({
        functionIndex: 8963,
        params: Object.freeze(["i32", "i32"] as const),
        results: Object.freeze([] as const),
        bodySha256: "4147a0600d662a5714f748d851e50500434d6cd4308df5a4125c2b7725cabe0c",
      }),
      nativeHudRendering: Object.freeze({
        functionBodies: Object.freeze([
          Object.freeze([13173, "9073c546fc41604e2ac35cddb34b91529a6cd6f67dfabc49b6e624131df26bde"] as const),
          Object.freeze([13136, "d3a59ae7b47e8aeffa7b531938b9481b9dac5a6b488d598efbeebdbe7baa21c3"] as const),
          Object.freeze([6584, "e5d996ecfbb22d697a122a69478bd1ef0ac2bf5540d040d849d427c8e84e88b0"] as const),
          Object.freeze([6450, "271c5607f21635fd648aed78849282ec5ee0b2fd39cecaeeecd2e33c63b180a8"] as const),
          Object.freeze([6598, "91f5cf516b125fd6181e4e003e4b6d7acc841c37052438bf9d213ff71e27bf87"] as const),
          Object.freeze([6585, "9e27e4f7e9bedac070483f3528bb612706c9e137a552998f6abe568ec1cb3372"] as const),
          Object.freeze([14076, "8b94707765c214c8ed2266829949f0cebae5f2d96184191bb5af8eb358954581"] as const),
          Object.freeze([1554, "469a8952e6ae97ebb639335b2c5aae486d4d3d70d4b866d5a2872b4aaf902fdf"] as const),
          Object.freeze([1572, "cc2ab24d872edcd8f3d2ea4367053a8a531a6806cb3444c6a0eb932b1551dc49"] as const),
          Object.freeze([6446, "aa5cb0cd4908d1ebf18644c9006079d2eaa00d3fde5000f3ae5209fe9e238607"] as const),
          Object.freeze([6447, "276987391bc660d4addc75d9f9915ce63d56bb8d94d2127c8f4f991fb6a8e39e"] as const),
          Object.freeze([1563, "89878e271646d74f19bd36c3a4be4fd9fff44b32494e5136be4c979744f9e494"] as const),
          Object.freeze([6488, "4d07845913433a58c2067e00d328c086a4789415c904d547d6e0ed9f9e2ee17d"] as const),
          Object.freeze([6492, "b4696a3d320bb3e175d398f3bc83d18fb6f1283a9a9dc5795a93fb936927c758"] as const),
          Object.freeze([6490, "31b15d23535cfe3959ef4df7f5eccfd7eac406d8418f42ad460b201948e8deba"] as const),
          Object.freeze([6593, "e9133b3700765951523114f6ed65cbc8bd804aaa5844ce6405e6cf4f70a0da9f"] as const),
          Object.freeze([5595, "7360f098727dd1b104924223849d92074c517ddccbcf03a3ef3f55789622035c"] as const),
          Object.freeze([1569, "12522803ed13e7cb2eef8ebe6d9f7818ae0ebdea848e8a8bfee9f6ac70747d65"] as const),
          Object.freeze([1579, "1808fc2f59f718ef98176177ffa94ff1c6ff1f4bb8f2b9308368783cfbf14507"] as const),
          Object.freeze([1559, "0b769a6aafe3a32d400494a4282b37d8b53da28d49ae5b3f90732066b7328c2d"] as const),
          Object.freeze([1444, "e818abdb06c6480269dff224f63739095c8a5c53272dbebd7b5fd69e03f85a2f"] as const),
          Object.freeze([1445, "4f068862295d2dda824c833d1bdaebb070cc697f16c293c3e657518537cb70ec"] as const),
          Object.freeze([1446, "abd11553718f61ba717fb37c8106045ba16d261f5bd881fbc2bce13c856a8471"] as const),
          Object.freeze([1448, "a043d1945fa2513ce44d86fb6264a5b7b06dd9ec85edab72ee650ed133ad079d"] as const),
          Object.freeze([1449, "11661d6c7e6ec6e5bb453c0a48f05365f99cf0525363de58a6662df2f4ba29d3"] as const),
          Object.freeze([2249, "e12a9448b5ec6c70639e944637e7975d0a5d676e075863825351e11d5e198f9c"] as const),
          Object.freeze([3137, "c12bdc0b59e47d271a359faf5840fc03a0e98bc34dbb97c263498a4aeb3f3b1c"] as const),
          Object.freeze([748, "da99a1f1dba71ee7f2c3430c4369fa5d29224b07af1067576498483887c0f4c5"] as const),
          Object.freeze([1333, "c90c8ed81da2c08f44ccbbc4780f27837c1a0f8d4a155fa1ef10a5db6fdb5b54"] as const),
          Object.freeze([1334, "380e12b02164f3bd7e1b10eff4629b9b05a7033746d65cfe652695bce3b1aac3"] as const),
          Object.freeze([1357, "ee4441d6823bbae764852f1962dff7f46463e1be383c08d8cb07837822e9a3d0"] as const),
          Object.freeze([264, "49fa58035bc3421d78b015b2a2fa193c666e7c0b78afd87a08e5466640d5bbee"] as const),
          Object.freeze([2922, "16df7a07758e9243fa6ecd2b7db14396210dff9f7bf38a8f8b235c73e18967d6"] as const),
          Object.freeze([2902, "c8f0622788ac3de16e86aca82d7b898e4d37b5791cb67758dcc374530b051555"] as const),
          Object.freeze([750, "85f06410df74a13d2a16882b80328b82e9c3f902c176ff494f22ba965008cb02"] as const),
          Object.freeze([1532, "e00ea47f7529e9875b28e703d5c3cea36483df45a526de208ee023975448ed04"] as const),
        ] as const),
      }),
      playerSkillbarObservation: Object.freeze({
        worldLifecycle: Object.freeze({
          functionIndex: 8818,
          params: Object.freeze(["i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "4b17d31aebec931fd482d7f1b0f378e1c68999a9a755f52699138060404ffe3f",
        }),
        update: Object.freeze({
          functionIndex: 8704,
          params: Object.freeze([] as const),
          results: Object.freeze([] as const),
          bodySha256: "034c27b93373990031cc071563ac2377036daeb799fd2bfcac6f0c7e3033f2ae",
        }),
        rowReader: Object.freeze({
          functionIndex: 8707,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "7b8b5c65a126fae2edfa517a4706244a0d2352c628fde208d049ecf82dfa4e72",
        }),
        slotReader: Object.freeze({
          functionIndex: 8708,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "ee41be1f4dcaf8e5822fc024e41cbbad74cf293cdafb2b89a8691aeb680e68b5",
        }),
        coreLayout: Object.freeze({
          worldSkillbars: 1776,
          skillbarStride: 188,
          skillbarAgentId: 0,
          skillbarSkills: 4,
          skillSlotStride: 20,
        }),
        partyLayout: Object.freeze({
          skillSlotId: 12,
          skillbarDisabled: 164,
        }),
      }),
      teamApply: Object.freeze({
        thunkExport: "enhancement_command",
        professionTrace: Object.freeze({
          readerExport: "enhancement_profession_trace",
          sender: Object.freeze({
            functionIndex: 5951,
            params: Object.freeze(["i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "f356a39b419774e117dd6b92a3a572235956421ab2dcb2f4c6fbdfbc2eb922a4",
          }),
        }),
        entries: Object.freeze([
          Object.freeze({
            opcode: 31,
            functionIndex: 6887,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "b4707ba68961478b04bd26740a635e7e6057df00fcf8f213514d01f7bd2e429a",
            label: "CharMsgSendHeroDeactivate(heroId)",
          }),
          Object.freeze({
            opcode: 30,
            functionIndex: 6886,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "66bb9d030c176e18df76ffea58684209ca7ea855440cc44e040410a9a424d0c5",
            label: "CharMsgSendHeroActivate(heroId)",
          }),
          Object.freeze({
            opcode: 21,
            functionIndex: 6878,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "6caf9a926312f6827f6229981d48348d8ad07ac2dd6411657aef7e5e27de1f5a",
            label: "CharMsgSendCommandAiMode(agentId, behavior)",
          }),
          Object.freeze({
            opcode: 93,
            functionIndex: 6943,
            params: Object.freeze(["i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "ad0ba348c1b48828ac169c184038a796f80710d7ffd01888e1770da7f15f7189",
            label: "skillbar set (agentId, count, skills[])",
          }),
          Object.freeze({
            opcode: 65,
            functionIndex: 6917,
            params: Object.freeze(["i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "d6f6f3745e75eb42dbae4bc6def2c213626679b5a899c169871ea577fcbf2cff",
            label: "CharMsgSendOrderSetProfessionSecondary(agentId, profession)",
          }),
          Object.freeze({
            opcode: 16,
            functionIndex: 6873,
            params: Object.freeze(["i32", "i32", "i32", "i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "65ac54b88cb4b4e0155e7a6676628679d4aad9f994a64a989fd3f0de0a90b195",
            label: "attributes set (agentId, count, ids[], ranks[])",
          }),
          Object.freeze({
            opcode: 155,
            functionIndex: 10661,
            params: Object.freeze(["i32"] as const),
            results: Object.freeze([] as const),
            bodySha256: "875225d80b2c9e488980853f512f63641de3b842c5239f62c3989b3da677cd88",
            label: "CharMsgSendSetHardMode(enabled)",
          }),
        ] as const),
      }),
      skillSlotGeometry: Object.freeze({
        initializer: Object.freeze({
          functionIndex: 15775,
          params: Object.freeze(["i32", "i32"] as const),
          results: Object.freeze([] as const),
          bodySha256: "968c145474ccf26e7b2b8bd64ee11c06cecd0e9d0af011474560111c421cf209",
          constructorCallOperand: 2157,
        }),
        constructor: Object.freeze({
          functionIndex: 6676,
          params: Object.freeze(["i32", "i32", "i32", "i32", "i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "501d4e22c342f594bebc1ade8b6280b369160c488e3b6f7b4ff40fe86ed01aca",
        }),
        labelAddress: 1601450,
        layout: Object.freeze({
          frameArray: 5923308,
          frameCount: 5923316,
          frameBytes: 456,
          frameChildOffsetId: 184,
          frameId: 188,
          framePositionFlags: 216,
          frameViewportWidth: 260,
          frameViewportHeight: 264,
          frameScreenLeft: 268,
          frameScreenBottom: 272,
          frameScreenRight: 276,
          frameScreenTop: 280,
          frameRelation: 296,
          frameState: 396,
        }),
      }),
      skillCooldownObservation: Object.freeze({
        reader: Object.freeze({
          functionIndex: 8710,
          params: Object.freeze(["i32", "i32", "i32"] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "4ea487e15fd9ceff5aefb1425e619567151516eed9ca7b9068aad937f89cb7ee",
          timerCallOperand: 200,
        }),
        timer: Object.freeze({
          functionIndex: 249,
          params: Object.freeze([] as const),
          results: Object.freeze(["i32"] as const),
          bodySha256: "20aad705e846ffd764f7de00845f7767b080329264e2526480ddb6d9d02df259",
        }),
        layout: Object.freeze({
          skillSlotRecharge: 8,
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
