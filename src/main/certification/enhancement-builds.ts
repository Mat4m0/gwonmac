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
      // Recomputed when the bounded `/tp` palette signal landed. All profiles move
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
          "8c156901f7fa5a7d1ee23b6b2f2b53ce6c511dc358974e694db208e965f5d151",
        target:
          "96786cba1fac260f0924e3b1880dd65452c552c4e79b4e5e8a72e835d4cca0c8",
        cursorTarget:
          "d4d2406669ef5be751843112cf7547fa640c8444bae95a23e0eaba3a2d9c1517",
        party:
          "b528291df4bd96541a8128fdd7de88b5712413fc192e6e051f71ac47459e221f",
        cursorParty:
          "b7dc1e345bbe85a91b5423b4fc609ab37abbe2d15a387f29cfc7fbc7534c9fec",
        targetParty:
          "0e4da3a2a31b6c84b12ada9f5f0ec87abdcb9c239349fa38d46aa472ecbf74df",
        cursorTargetParty:
          "4b5f4601b3ddfe363b9fc49a8130df417b28dc7ddcc75b0cc83a6dca3d21458d",
        partyCommands:
          "97213e19d336ccecd26a25d20291d4ee03fdd3102f4a58a56ce4e0ea2e0353b7",
        cursorPartyCommands:
          "aca4e4ff310162036a9dccab2d9d4180f4699930ca3e9337de8529ff391d245c",
        targetPartyCommands:
          "80d86e2af5c5f1160610ae17482e6385ff3990e97fbfbd798e7396be810b4e84",
        cursorTargetPartyCommands:
          "00f8385b8343231e1f61bdac7a7ada1c48946d114f812e8c0927454eea72100c",
        storage:
          "04a0532fd2d5e6f3ecbbc050afaf47370a7f6b479431b471bf76d738a2e06e8a",
        partyStorage:
          "43fa20fadf5b466976505696b80d95653c9b26f661ddf86959eb1cfbca6a9693",
        cursorPartyStorage:
          "db8dec116c17306853f5075926b657ee1d46d9ad04ae6cd1fc683638e89b7e9f",
        targetPartyStorage:
          "92fbaba14a4986ad46cd5f412eccbc51d26bd41241bb6d6eb736df6d88216df3",
        cursorTargetPartyStorage:
          "e58f556348af308a9e13b011588baf57a2eacb1213e0d25fbda8a12eb6aaf7d6",
        partyCommandsStorage:
          "36ea50a64185d69da0f5e5de02d1e20a8fefcc0402cf19be22522de5ce795974",
        cursorPartyCommandsStorage:
          "b98fb10c37deda13b06b79b19efa9130ae70aca62c7df3da75b463bc62af2f4b",
        targetPartyCommandsStorage:
          "cc07d6c49c6a8079679114806231ecf2d015e41b7dab1242dacd8b7687bf8869",
        cursorTargetPartyCommandsStorage:
          "58f0ce10fd231263e560e2496e07b6e152241c41e3ac0b6d04e7f13ca44ee924",
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
          agentX: 0x74,
          agentY: 0x78,
          agentType: 0x9c,
          agentPlayerNumber: 0xf4,
          agentModelType: 0xf6,
          worldContext: 0x2c,
          // Exact-build initialised `AreaInfo[mapId]`. Cross-checked against
          // GWToolbox++'s flags: Lion's Arch (55) is PvE, Random Arenas (188)
          // carries the PvP bit, and Isle of Wurms (529) the guild-hall bit.
          areaInfo: 0x1cc630,
          areaInfoCount: 883,
          areaInfoStride: 0x7c,
          areaInfoFlags: 0x10,
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
      storage: Object.freeze({
        openExport: "enhancement_open_storage",
        configureExport: "enhancement_configure_storage",
        // Exact build-38,833 player access facts. The client readers below
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
                "2a4f5c421482aed52cffc3f58575622a7302492aea86012019b8b683de46cba4",
            }),
            "access-flags": Object.freeze({
              functionIndex: 9196,
              params: Object.freeze(["i32"] as const),
              results: Object.freeze(["i32"] as const),
              bodySha256:
                "620dd5c413423a797119e43a102ae7b2cbe3a633ca41f607bf6a2d7988d1412f",
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
        travel: Object.freeze({
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
