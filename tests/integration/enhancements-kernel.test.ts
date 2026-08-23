import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  ALL_FEATURES,
  COMPANION_CURSOR_BYTES,
  COMPANION_PARTY_BYTES,
  COMPANION_TOOLBOX_BYTES,
  CONFIG_BYTES,
  createKernel,
  CURSOR,
  decoded,
  DETAIL,
  FEATURE_NATIVE_CURSOR,
  FEATURE_GAME_SNAPSHOT,
  FEATURE_TOOLBOX_FOUNDATION,
  FEATURE_SKILL_KEY_OVERLAY,
  installCursorGraph,
  installGameGraph,
  installPartyDetailGraph,
  installSkillBarGraph,
  MESSAGE_CONFIG_START,
  paintCursor,
  PARTY_DIRTY_MESSAGES,
  publishedPixels,
  readChangedCompanionParty,
  readChangedCompanionToolbox,
  readCompanionSnapshot,
  readyParty,
  readyToolbox,
  rejected,
  sameCompanionToolboxState,
} from "../fixtures/enhancements.ts";

describe("Companion kernel", () => {
  it("returns from adversarial callback scalars without panicking", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installCursorGraph(kernel.view);
    paintCursor(kernel.view, 1);
    assert.equal(
      kernel.init({
        features:
          FEATURE_NATIVE_CURSOR
          | FEATURE_GAME_SNAPSHOT
          | FEATURE_TOOLBOX_FOUNDATION,
      }),
      1,
    );
    const exportedDispatch = kernel.instance.exports.companion_dispatch;
    assert.equal(typeof exportedDispatch, "function");
    const dispatch = exportedDispatch as CallableFunction;
    for (const kind of [0, 1, 2, 3, 0x7fff_ffff, 0xffff_ffff]) {
      assert.doesNotThrow(() => dispatch(
        kind,
        0xffff_ffff,
        0x8000_0000,
        0x7fff_ffff,
        0xffff_ffff,
        0x8000_0000,
      ));
    }
  });

  it("publishes a checked snapshot after a game tick", async () => {
    const kernel = await createKernel();
    const { view, config, instance } = kernel;
    installGameGraph(view);

    assert.equal(kernel.init({ snapshotPointer: 0xffff_fffc }), 0);
    assert.equal(kernel.init({ snapshotSize: 63 }), 0);
    assert.equal(kernel.init({ configSize: CONFIG_BYTES - 4 }), 0);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    const state = decoded(
      readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(state.status, "ready");
    assert.equal(state.tickCount, 1);
    assert.equal(state.playerId, 7);
    assert.equal(state.targetId, 9);
    assert.ok(Math.abs(state.distance - 100) < 0.1);
    assert.equal(state.rangeName, "Adjacent");

    const boundaries: [distance: number, band: number][] = [
      [166, 1],
      [166.25, 2],
      [252.25, 3],
      [322.25, 4],
      [1_012.25, 5],
      [1_248.25, 6],
      [2_500.25, 7],
      [5_000.25, 8],
    ];
    for (const [distance, band] of boundaries) {
      view.setFloat32(ADDRESSES.target + 0x74, 10 + distance, true);
      kernel.tick();
      assert.equal(
        decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
          .rangeBand,
        band,
      );
    }

    view.setUint32(ADDRESSES.manualTargetId, 0, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .targetValid,
      false,
    );

    view.setUint32(ADDRESSES.automaticTargetId, 9, true);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot))
        .targetId,
      9,
    );

    view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.tick();
    const loading = readCompanionSnapshot(
      kernel.memory.buffer,
      ADDRESSES.snapshot,
    );
    assert.equal(rejected(loading), "loading");
    assert.equal("playerId" in loading, false);
    assert.equal("targetId" in loading, false);

    view.setUint32(ADDRESSES.character + 0x23c, 0, true);
    view.setFloat32(ADDRESSES.player + 0x74, Number.NaN, true);
    kernel.tick();
    assert.equal(
      rejected(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)),
      "game",
    );

    config[0] = 0xffff_fffc;
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(
      rejected(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)),
      "game",
    );
    assert.equal(typeof instance.exports.companion_dispatch, "function");
  });

  it("collects only the explicitly enabled tools", async () => {
    const cursorOnly = await createKernel();
    installGameGraph(cursorOnly.view);
    installCursorGraph(cursorOnly.view);
    paintCursor(cursorOnly.view, 1);
    assert.equal(
      cursorOnly.init({ features: FEATURE_NATIVE_CURSOR }),
      1,
    );
    assert.equal(
      cursorOnly.view.getUint32(ADDRESSES.snapshot, true),
      0,
    );
    cursorOnly.tick();
    assert.equal(publishedPixels(cursorOnly.published()).status, "ready");
    assert.equal(
      cursorOnly.view.getUint32(ADDRESSES.snapshot, true),
      0,
    );

    const readoutOnly = await createKernel();
    installGameGraph(readoutOnly.view);
    installCursorGraph(readoutOnly.view);
    paintCursor(readoutOnly.view, 2);
    assert.equal(
      readoutOnly.init({ features: FEATURE_GAME_SNAPSHOT }),
      1,
    );
    assert.equal(readoutOnly.field(CURSOR.magic), 0);
    readoutOnly.tick();
    const state = decoded(
      readCompanionSnapshot(readoutOnly.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(state.status, "ready");
    assert.equal(state.tickCount, 1);
    assert.equal(readoutOnly.field(CURSOR.magic), 0);

  });

  it("publishes all eight skill-slot rectangles or no overlay", async () => {
    const kernel = await createKernel();
    installSkillBarGraph(kernel.view);
    assert.equal(
      kernel.init({ features: FEATURE_SKILL_KEY_OVERLAY }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_TOOLBOX_FOUNDATION | FEATURE_SKILL_KEY_OVERLAY,
      }),
      1,
    );
    kernel.tick(1);
    const ready = kernel.skillKeys();
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.frameId, 1);
    assert.equal(ready.viewportWidth, 800);
    assert.equal(ready.viewportHeight, 600);
    assert.deepEqual(ready.slots[7], {
      left: 464,
      bottom: 20,
      right: 512,
      top: 68,
    });

    // A missing child must clear the complete publication. Keeping seven old
    // labels would put valid-looking keys over the wrong skills.
    kernel.view.setUint32(ADDRESSES.frameTable + 9 * 4, 0, true);
    kernel.tick(1);
    assert.deepEqual(kernel.skillKeys(), { status: "waiting", reason: "frame" });
  });

  it("keeps map policy live while a disabled target observer stops reading targets", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: ALL_FEATURES }), 1);
    kernel.tick();
    assert.equal(
      decoded(readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot)).targetId,
      9,
    );

    kernel.activeFeatures(FEATURE_NATIVE_CURSOR);
    kernel.view.setUint32(ADDRESSES.agentBuffer + 9 * 4, 0xffff_fffc, true);
    kernel.tick();
    const policy = decoded(
      readCompanionSnapshot(kernel.memory.buffer, ADDRESSES.snapshot),
    );
    assert.equal(policy.playRegion, "pve");
    assert.equal(policy.playerId, 7);
    assert.equal(policy.targetValid, false);
  });

  it("requires UI message configuration only for the Toolbox capability", async () => {
    const cursorOnly = await createKernel();
    cursorOnly.config.fill(0, MESSAGE_CONFIG_START);
    assert.equal(cursorOnly.init({ features: FEATURE_NATIVE_CURSOR }), 1);

    const readoutOnly = await createKernel();
    readoutOnly.config.fill(0, MESSAGE_CONFIG_START);
    assert.equal(readoutOnly.init({ features: FEATURE_GAME_SNAPSHOT }), 1);

    const toolbox = await createKernel();
    toolbox.config.fill(0, MESSAGE_CONFIG_START);
    assert.equal(
      toolbox.init({ features: FEATURE_TOOLBOX_FOUNDATION }),
      0,
    );

    const missingDirty = await createKernel();
    missingDirty.config[MESSAGE_CONFIG_START + 3] = 0;
    assert.equal(
      missingDirty.init({ features: FEATURE_TOOLBOX_FOUNDATION }),
      0,
    );

    const duplicateDirty = await createKernel();
    duplicateDirty.config[MESSAGE_CONFIG_START + 4] =
      duplicateDirty.config[MESSAGE_CONFIG_START + 3]!;
    assert.equal(
      duplicateDirty.init({ features: FEATURE_TOOLBOX_FOUNDATION }),
      0,
    );
  });

  it("observes Toolbox heroes and the exact player agent", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const toolbox = readyToolbox(kernel.toolbox());
    assert.equal(toolbox.heroAvailable, true);
    assert.equal(toolbox.firstHeroId, 1);
    assert.equal(toolbox.firstHeroAgentId, 77);
  });

  // The party region is the toolbox region's argument taken to its conclusion:
  // the same walk, publishing who rather than merely whether. These fixtures
  // carry no party-detail offsets -- those words are zero, which the kernel
  // reads as "not certified, do not traverse" -- so what is asserted here is
  // that the roster survives without them and that every unread field says so
  // rather than arriving as a plausible default.
  it("publishes a roster whose unread fields admit they are unread", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const party = kernel.party();
    if (party.status !== "ready") {
      throw new Error(`expected a party region, got ${JSON.stringify(party)}`);
    }
    assert.equal(party.rosterObserved, true);
    assert.equal(party.slotCount, 1);

    // Slot 0 is the player, so a one-hero party occupies slot 1.
    const [player, hero] = party.slots;
    assert.equal(player?.occupied, true);
    assert.equal(player?.hero, null);
    assert.equal(player?.agentId, 7);
    assert.equal(hero?.occupied, true);
    assert.equal(hero?.hero, 1);
    assert.equal(hero?.agentId, 77);

    assert.equal(player?.professions, null, "profession table was not configured");
    // Uncertified groups were skipped whole rather than read as zero.
    assert.equal(hero?.professions, null, "professions");
    assert.equal(hero?.behaviour, null, "behaviour");
    assert.equal(hero?.skills, null, "skill bar");
    assert.equal(hero?.disabled, null, "disabled mask");
    assert.equal(party.unlockObserved, false);
    assert.equal(party.unlocked, null, "unlock table");
    assert.equal(party.accountSkills, null, "account skills");
    assert.equal(party.characterSkills, null, "character skills");
  });

  it("retracts the roster when the party cannot be read", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    assert.equal(readyParty(kernel.party()).slotCount, 1);

    // Break the party pointer and force a walk. A half-read party must not be
    // published as a small one: the whole observation is withdrawn.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();

    const party = readyParty(kernel.party());
    assert.equal(party.rosterObserved, false);
    assert.equal(party.slotCount, 0);
    assert.equal(party.slots.every((slot) => slot.occupied === false), true);
  });

  // The certified party-detail layout, walked end to end. Everything above
  // exercises the roster with the detail words zeroed; this is the walk that
  // actually reads three arrays and sixty-four skill ids.
  it("fills the roster in from the certified detail offsets", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const party = readyParty(kernel.party());
    assert.equal(party.slotCount, 1, "the foreign hero stayed out");
    const player = party.slots[0];
    const hero = party.slots[1];
    assert.equal(player?.agentId, 7);
    assert.deepEqual(player?.professions, [3, 5], "player professions");
    assert.deepEqual(
      player?.skills,
      [120, 121, 122, 123, 124, 125, 126, 127],
      "player skill bar",
    );
    assert.deepEqual(player?.attributes, [[1, 3], [14, 10], [16, 8]]);
    assert.equal(hero?.hero, 1);
    assert.deepEqual(hero?.professions, [1, 2], "primary and secondary");
    assert.equal(hero?.behaviour, 1);
    assert.deepEqual(
      hero?.skills,
      [100, 101, 102, 103, 104, 105, 106, 107],
      "eight ids at the certified slot stride",
    );
    assert.equal(hero?.disabled, 0b101);

    // Ranks by id, invested only. Rank 0 is not published: an absent attribute
    // already means zero on the other side, and publishing it would make a
    // character who spent nothing indistinguishable from one nobody read.
    assert.deepEqual(hero?.attributes, [[17, 7], [19, 12], [24, 3]]);
    assert.equal(party.unlockObserved, true);
    assert.deepEqual(party.unlocked, [1, 2], "hero_info is account-scoped");
    assert.deepEqual(party.accountSkills, {
      knownThrough: 2_240,
      unlocked: [202, 216, 249],
    });
    assert.deepEqual(party.characterSkills, {
      knownThrough: 2_240,
      unlocked: [202, 216],
    });
    // The fixture's character context says outpost, and applying a team is an
    // outpost-only operation — so the flag has to survive the walk rather than
    // being something the interface assumes.
    assert.equal(party.inOutpost, true);
  });

  it("keeps the roster and unrelated facts when one detail table rejects", async () => {
    const cases = [
      {
        name: "profession states",
        offset: DETAIL.professionStates,
        verify(party: ReturnType<typeof readyParty>) {
          assert.equal(party.slots[0]?.professions, null);
          assert.deepEqual(party.slots[1]?.professions, [1, 2], "HeroInfo fallback");
          assert.equal(party.slots[1]?.behaviour, 1);
          assert.deepEqual(party.slots[1]?.skills?.slice(0, 2), [100, 101]);
          assert.deepEqual(party.slots[1]?.attributes, [[17, 7], [19, 12], [24, 3]]);
          assert.equal(party.unlockObserved, true);
        },
      },
      {
        name: "hero info",
        offset: DETAIL.heroInfo,
        verify(party: ReturnType<typeof readyParty>) {
          assert.equal(party.unlockObserved, false);
          assert.deepEqual(party.slots[0]?.professions, [3, 5]);
          assert.deepEqual(party.slots[1]?.professions, [1, 2]);
          assert.equal(party.slots[1]?.behaviour, 1);
          assert.deepEqual(party.slots[1]?.skills?.slice(0, 2), [100, 101]);
          assert.deepEqual(party.slots[1]?.attributes, [[17, 7], [19, 12], [24, 3]]);
        },
      },
      {
        name: "hero flags",
        offset: DETAIL.heroFlags,
        verify(party: ReturnType<typeof readyParty>) {
          assert.equal(party.slots[1]?.behaviour, null);
          assert.deepEqual(party.slots[1]?.professions, [1, 2]);
          assert.deepEqual(party.slots[1]?.skills?.slice(0, 2), [100, 101]);
          assert.deepEqual(party.slots[1]?.attributes, [[17, 7], [19, 12], [24, 3]]);
          assert.equal(party.unlockObserved, true);
        },
      },
      {
        name: "skill bars",
        offset: DETAIL.skillbars,
        verify(party: ReturnType<typeof readyParty>) {
          assert.equal(party.slots[1]?.skills, null);
          assert.equal(party.slots[1]?.disabled, null);
          assert.deepEqual(party.slots[1]?.professions, [1, 2]);
          assert.equal(party.slots[1]?.behaviour, 1);
          assert.deepEqual(party.slots[1]?.attributes, [[17, 7], [19, 12], [24, 3]]);
          assert.equal(party.unlockObserved, true);
        },
      },
      {
        name: "attributes",
        offset: DETAIL.attributes,
        verify(party: ReturnType<typeof readyParty>) {
          assert.equal(party.slots[1]?.attributes, null);
          assert.deepEqual(party.slots[1]?.professions, [1, 2]);
          assert.equal(party.slots[1]?.behaviour, 1);
          assert.deepEqual(party.slots[1]?.skills?.slice(0, 2), [100, 101]);
          assert.equal(party.unlockObserved, true);
        },
      },
    ] as const;

    for (const detail of cases) {
      const kernel = await createKernel({ partyDetail: true });
      installGameGraph(kernel.view);
      installPartyDetailGraph(kernel.view);
      // Every detail table is a three-word array header. A size above the
      // certified bound makes that group reject without damaging the roster.
      kernel.view.setUint32(ADDRESSES.world + detail.offset + 4, 65, true);
      kernel.view.setUint32(ADDRESSES.world + detail.offset + 8, 65, true);
      assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
      kernel.tick();

      const party = readyParty(kernel.party());
      assert.equal(party.rosterObserved, true, `${detail.name}: roster observation`);
      assert.equal(party.slotCount, 1, `${detail.name}: complete owned roster`);
      assert.equal(party.slots[0]?.agentId, 7, `${detail.name}: player`);
      assert.equal(party.slots[1]?.hero, 1, `${detail.name}: hero`);
      detail.verify(party);
    }
  });

  it("reads player professions from the canonical party state", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const party = readyParty(kernel.party());
    const player = party.slots[0];
    assert.deepEqual(player?.professions, [3, 5]);
    assert.deepEqual(player?.attributes, [[1, 3], [14, 10], [16, 8]]);
    assert.deepEqual(party.playerProfessionProbe, {
      statePrimary: 3,
      stateSecondary: 5,
      attributeIdsLow: 122_894,
      attributeIdsHigh: 0,
      stateRowObserved: true,
      stateAccepted: true,
      attributeRowObserved: true,
    });
  });

  it("keeps live hero professions ahead of stale account metadata", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);

    // HeroInfo still says W/R, while the live agent-keyed profession table has
    // moved Devona to W/N. This is the exact shape observed in the client after
    // changing a hero's secondary profession in the party window.
    kernel.view.setUint32(
      ADDRESSES.professionStateBuffer + 8,
      4,
      true,
    );
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const party = readyParty(kernel.party());
    assert.deepEqual(party.slots[1]?.professions, [1, 4]);
    assert.deepEqual(
      party.accountProfessions?.find((entry) => entry.hero === 1)?.professions,
      [1, 2],
      "HeroInfo remains the account-wide fallback",
    );

    // Profession changes have no certified party-dirty message. The bounded
    // reconciliation must still replace the live value within two seconds,
    // and the unchanged HeroInfo row must not overwrite it again.
    const sequence = party.sequence;
    kernel.view.setUint32(
      ADDRESSES.professionStateBuffer + 8,
      5,
      true,
    );
    for (let tick = 0; tick < 119; tick += 1) kernel.tick();
    assert.equal(readyParty(kernel.party()).sequence, sequence);
    kernel.tick();
    const changed = readyParty(kernel.party());
    assert.ok(changed.sequence > sequence);
    assert.deepEqual(changed.slots[1]?.professions, [1, 5]);
  });

  it("keeps character unlocks when the account table fails closed", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    kernel.view.setUint32(
      ADDRESSES.account + DETAIL.accountUnlockedSkills + 4,
      129,
      true,
    );
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const party = readyParty(kernel.party());
    assert.equal(party.accountSkills, null);
    assert.deepEqual(party.characterSkills, {
      knownThrough: 2_240,
      unlocked: [202, 216],
    });
    assert.equal(party.rosterObserved, true);
  });

  // A party nobody walked cannot say where it is standing, and the difference
  // decides whether Apply refuses or explains that it does not know yet.
  it("says nothing about the instance when the walk was rejected", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    assert.equal(readyParty(kernel.party()).inOutpost, true);

    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();
    const rejected = readyParty(kernel.party());
    assert.equal(rejected.rosterObserved, false);
    assert.equal(rejected.inOutpost, null, "not false: nobody looked");
  });

  // The anomaly the live session turned up, as a regression: `index == id` is
  // the admission rule precisely because the reference struct's padding past
  // id 44 decodes as a plausible rank. Without it the fixture's row publishes
  // Air Magic at rank 8 on a Warrior, and a captured build would carry it into
  // the library and out again as a template.
  it("takes index == id as the rule, so struct padding is not a rank", async () => {
    const kernel = await createKernel({ partyDetail: true });
    installGameGraph(kernel.view);
    installPartyDetailGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    // Exactly the three invested ranks. Air Magic (8) is what the padding at
    // index 53 reads as, and it is absent because the whole list is asserted
    // rather than a predicate over it.
    const ranks = readyParty(kernel.party()).slots[1]?.attributes;
    assert.deepEqual(ranks, [[17, 7], [19, 12], [24, 3]]);
    // And the rule is structural, not a range check on the index: an entry
    // *inside* the walked range whose id disagrees with its position is
    // rejected the same way.
    const at = ADDRESSES.attributeBuffer
      + DETAIL.attributeEntries + 20 * DETAIL.attributeEntryStride;
    kernel.view.setUint32(at + DETAIL.attributeEntryId, 21, true);
    kernel.view.setUint32(at + DETAIL.attributeEntryRank, 9, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();

    const after = readyParty(kernel.party()).slots[1]?.attributes ?? [];
    assert.deepEqual(after, ranks, "a mismatched entry changes nothing");
  });

  // The reconciliation walk exists to catch changes no certified message
  // announces — editing a hero's skill bar is exactly that — so it runs on a
  // timer whether or not anything happened. Republishing what it already
  // published would move the sequence twice a second forever, which makes
  // "the sequence moved" useless as the cheap question a reader wants to ask.
  it("republishes the roster only when the roster changed", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const { sequence, generation } = readyParty(kernel.party());

    // Well past RECONCILE_TICKS, so the recovery walk has run several times.
    for (let tick = 0; tick < 300; tick += 1) kernel.tick();
    const idle = readyParty(kernel.party());
    assert.equal(idle.sequence, sequence, "sequence");
    assert.equal(idle.generation, generation, "generation");

    // And a change nothing announced is still picked up — by that same walk,
    // which is the whole reason it runs on a timer.
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 5, true);
    for (let tick = 0; tick < 130; tick += 1) kernel.tick();
    const changed = readyParty(kernel.party());
    assert.notEqual(changed.sequence, sequence);
    assert.equal(changed.generation, generation + 1, "exactly one publication");
    assert.equal(changed.slots[1]?.hero, 5);
  });

  // The counterpart of the Toolbox header test below it, and the bug it exists
  // for: the party was originally re-read on the *toolbox* sequence, which
  // counts a different thing. Swapping a skill on a hero's bar moves no scalar
  // the toolbox summary carries, so the panel — and capture with it — kept
  // serving the roster from before the edit.
  it("reads only the party header while its sequence is unchanged", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const first = readChangedCompanionParty(
      kernel.memory.buffer,
      ADDRESSES.party,
      null,
    );
    assert.equal(first.changed, true);
    assert.notEqual(first.sequence, null);
    assert.deepEqual(
      readChangedCompanionParty(kernel.memory.buffer, ADDRESSES.party, first.sequence),
      { changed: false, sequence: first.sequence },
    );

    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 5, true);
    kernel.uiEvent(0x1000_011f, 0, 0);
    kernel.tick();
    const changed = readChangedCompanionParty(
      kernel.memory.buffer,
      ADDRESSES.party,
      first.sequence,
    );
    assert.equal(changed.changed, true);
    assert.notEqual(changed.sequence, first.sequence);
  });

  it("traverses party state only for the exact dirty-message set", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const ready = readyToolbox(kernel.toolbox());
    assert.equal(ready.heroAvailable, true);

    // Keep the last published projection but make the canonical party pointer
    // invalid. An unrelated central-dispatch message must not schedule a walk.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    kernel.uiEvent(0x1000_0080, 0xdead_beef, 0x7fff_fffd);
    kernel.tick();
    let state = readyToolbox(kernel.toolbox());
    assert.equal(state.sequence, ready.sequence);
    assert.equal(state.heroAvailable, true);
    // No walk ran, so the last real reading stands rather than being retracted.
    assert.equal(state.partyObserved, true);

    // The certified party removal is dirty-only: it publishes nothing in the
    // callback, then the next tick traverses and invalidates stale hero state.
    kernel.uiEvent(0x1000_011f, 0xdead_beef, 0x7fff_fffd);
    assert.equal(readyToolbox(kernel.toolbox()).sequence, ready.sequence);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.ok(state.sequence > ready.sequence);
    assert.equal(state.heroAvailable, false);
    // The party pointer is still the invalid one installed above, so this walk
    // began and rejected what it found. That is *not* an empty party, and the
    // kernel used to publish it as one — hero count 0 with no hero flag, the
    // same bytes a heroless outpost produces. A reader could not tell them
    // apart, and the panel reported "no heroes in your party" through every map
    // load. Absence of this bit is the only thing that says nobody read.
    assert.equal(state.partyObserved, false);

    // A certified map-loaded boundary also restores a replaced party graph.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, ADDRESSES.partyContext, true);
    kernel.uiEvent(0x1000_008c, 0, 0);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, true);
    assert.equal(state.partyObserved, true, "a completed walk claims its reading");
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [1, 77],
    );

    // Every member of the certificate tuple arms the same coalesced dirty bit;
    // this also pins the Rust comparison to all ten config positions.
    for (const [index, message] of PARTY_DIRTY_MESSAGES.entries()) {
      const heroId = index + 2;
      const agentId = index + 100;
      kernel.view.setUint32(ADDRESSES.heroBuffer + 0x00, agentId, true);
      kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, heroId, true);
      kernel.uiEvent(message, 0, 0);
      kernel.tick();
      state = readyToolbox(kernel.toolbox());
      assert.deepEqual(
        [state.firstHeroId, state.firstHeroAgentId],
        [heroId, agentId],
      );
    }
  });

  it("counts chat without calling back into the game", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(
      kernel.init({
        features: FEATURE_GAME_SNAPSHOT | FEATURE_TOOLBOX_FOUNDATION,
      }),
      1,
    );
    kernel.tick();
    let state = readyToolbox(kernel.toolbox());
    assert.equal(state.playerChatCount, 0);
    assert.equal(state.heroAvailable, true);
    assert.equal(state.heroCount, 1);
    assert.equal(state.firstHeroId, 1);
    assert.equal(state.firstHeroAgentId, 77);

    const initialSequence = state.sequence;
    kernel.uiEvent(0x1000_0080, 0xdead_beef, 0x7fff_fffd);
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.playerChatCount, 0);
    assert.equal(state.sequence, initialSequence);
    kernel.tick();
    assert.equal(readyToolbox(kernel.toolbox()).sequence, initialSequence);
    kernel.uiEvent(0x1000_0082, 0xdead_beef, 0x7fff_fffd);
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.playerChatCount, 1);
  });

  it("observes heroes on UI changes with a bounded quiet reconciliation", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    // The hero observer needs game + party + player-number only. Poisoning the
    // agent-array ceiling proves Toolbox-only collection cannot fall back to
    // the target readout's 4,096-entry agent search.
    kernel.view.setUint32(ADDRESSES.agentArray + 4, 5_000, true);
    kernel.view.setUint32(ADDRESSES.agentArray + 8, 5_000, true);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);

    kernel.tick();
    let state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, true);
    assert.deepEqual(
      [state.heroCount, state.firstHeroId, state.firstHeroAgentId],
      [1, 1, 77],
    );

    // A canonical change without a callback is intentionally invisible on
    // quiet ticks: no party traversal and no snapshot publication occurs.
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x00, 99, true);
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 3, true);
    const quietSequence = state.sequence;
    for (let tick = 0; tick < 119; tick += 1) kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.sequence, quietSequence);
    assert.equal(state.firstHeroId, 1);

    // The 120th quiet tick is the bounded recovery path for a missed event.
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.ok(state.sequence > quietSequence);
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [3, 99],
    );

    // A certified party mutation is the dirty boundary. It does not publish by
    // itself; one following tick reconciles canonical state.
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x00, 100, true);
    kernel.view.setUint32(ADDRESSES.heroBuffer + 0x08, 4, true);
    const beforeDirty = state.sequence;
    kernel.uiEvent(0x1000_011e, 0, 0);
    assert.equal(readyToolbox(kernel.toolbox()).sequence, beforeDirty);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [4, 100],
    );

    // Loading invalidates the projection once. Repeated dirty callbacks while
    // it remains unavailable do not churn the seqlock or renderer.
    kernel.view.setUint32(ADDRESSES.character + 0x23c, 2, true);
    kernel.uiEvent(0x1000_00c2, 0, 0);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, false);
    const loadingSequence = state.sequence;

    // Two scheduled reconciliation periods may validate lifecycle state while
    // loading, but must not walk the party vector or republish. Keep the party
    // root deliberately invalid throughout that window.
    kernel.view.setUint32(ADDRESSES.game + 0x4c, 0xffff_fffc, true);
    for (let tick = 0; tick < 240; tick += 1) kernel.tick();
    assert.equal(readyToolbox(kernel.toolbox()).sequence, loadingSequence);

    kernel.uiEvent(0x1000_0098, 0, 0);
    kernel.tick();
    assert.equal(readyToolbox(kernel.toolbox()).sequence, loadingSequence);

    kernel.view.setUint32(ADDRESSES.character + 0x23c, 0, true);
    kernel.view.setUint32(ADDRESSES.game + 0x4c, ADDRESSES.partyContext, true);
    kernel.uiEvent(0x1000_008c, 0, 0);
    assert.equal(readyToolbox(kernel.toolbox()).sequence, loadingSequence);
    kernel.tick();
    state = readyToolbox(kernel.toolbox());
    assert.equal(state.heroAvailable, true);
    assert.deepEqual(
      [state.firstHeroId, state.firstHeroAgentId],
      [4, 100],
    );
  });

  it("compares Toolbox projections by decoded value", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();
    const first = kernel.toolbox();
    assert.equal(sameCompanionToolboxState(null, first), false);
    assert.equal(sameCompanionToolboxState(first, kernel.toolbox()), true);

    const sequence = readyToolbox(first).sequence;
    kernel.view.setUint32(ADDRESSES.toolbox + 8, sequence + 2, true);
    const republished = kernel.toolbox();
    assert.equal(sameCompanionToolboxState(first, republished), true);
    kernel.view.setUint32(ADDRESSES.toolbox + 16, 1, true);
    assert.equal(sameCompanionToolboxState(republished, kernel.toolbox()), false);
  });

  it("reads only the Toolbox header while its generation is unchanged", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    assert.equal(kernel.init({ features: FEATURE_TOOLBOX_FOUNDATION }), 1);
    kernel.tick();

    const first = readChangedCompanionToolbox(
      kernel.memory.buffer,
      ADDRESSES.toolbox,
      null,
    );
    assert.equal(first.changed, true);
    assert.notEqual(first.sequence, null);
    const unchanged = readChangedCompanionToolbox(
      kernel.memory.buffer,
      ADDRESSES.toolbox,
      first.sequence,
    );
    assert.deepEqual(unchanged, {
      changed: false,
      sequence: first.sequence,
    });

    kernel.uiEvent(0x1000_0082, 0, 0);
    const changed = readChangedCompanionToolbox(
      kernel.memory.buffer,
      ADDRESSES.toolbox,
      first.sequence,
    );
    assert.equal(changed.changed, true);
    assert.notEqual(changed.sequence, first.sequence);
  });

  it("writes only its explicitly owned regions under mixed callback load", async () => {
    const kernel = await createKernel();
    installGameGraph(kernel.view);
    installCursorGraph(kernel.view);
    paintCursor(kernel.view, 7);
    assert.equal(kernel.init({
      features: FEATURE_NATIVE_CURSOR
        | FEATURE_GAME_SNAPSHOT
        | FEATURE_TOOLBOX_FOUNDATION,
    }), 1);
    const before = new Uint8Array(kernel.memory.buffer).slice();

    for (let index = 0; index < 512; index += 1) {
      kernel.tick();
      kernel.cursorEvent(index, index + 1, index + 2, index + 3, index + 4);
      kernel.uiEvent(index % 2 ? 0x1000_0082 : 0x1000_0080, index, 0);
      kernel.uiEvent(index % 2 ? 0x1000_01a3 : 0x1000_01a4, 1, 0);
    }

    const owned = [
      [ADDRESSES.snapshot, ADDRESSES.snapshot + 64],
      [ADDRESSES.cursor, ADDRESSES.cursor + COMPANION_CURSOR_BYTES],
      [ADDRESSES.toolbox, ADDRESSES.toolbox + COMPANION_TOOLBOX_BYTES],
      [ADDRESSES.party, ADDRESSES.party + COMPANION_PARTY_BYTES],
      [ADDRESSES.companionRuntime, ADDRESSES.companionRuntime + 65_536],
    ] as const;
    const after = new Uint8Array(kernel.memory.buffer);
    for (let address = 0; address < after.byteLength; address += 1) {
      if (owned.some(([start, end]) => address >= start && address < end)) {
        continue;
      }
      assert.equal(
        after[address],
        before[address],
        `companion wrote outside an owned region at 0x${address.toString(16)}`,
      );
    }
  });

  it("rejects empty, unknown, missing, or unselected feature regions", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.init({ features: 0 }), 0);
    assert.equal(kernel.init({ features: 1 << 3 }), 0);
    assert.equal(
      kernel.init({
        features: FEATURE_NATIVE_CURSOR,
        cursorPointer: 0,
        cursorSize: 0,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_GAME_SNAPSHOT,
        snapshotPointer: 0,
        snapshotSize: 0,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_NATIVE_CURSOR,
        snapshotPointer: ADDRESSES.snapshot,
        snapshotSize: 64,
      }),
      0,
    );
    assert.equal(
      kernel.init({
        features: FEATURE_GAME_SNAPSHOT,
        cursorPointer: ADDRESSES.cursor,
        cursorSize: COMPANION_CURSOR_BYTES,
      }),
      0,
    );

    kernel.tick();
    assert.equal(kernel.view.getUint32(ADDRESSES.snapshot, true), 0);
    assert.equal(kernel.field(CURSOR.magic), 0);
  });

});
