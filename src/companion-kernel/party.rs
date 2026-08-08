//! The full party projection, and the sole writer of the party region.
//!
//! The toolbox region answers "is a hero there"; this one answers "who, with
//! what". It shares that module's scheduling — the certified dirty-message set
//! plus a low-rate reconciliation — because it reads the same graph and a
//! second traversal cadence would double the cost of every party change.
//!
//! Three rules govern everything below.
//!
//! **Nothing is claimed that was not read.** Every field has a flag beside it,
//! because a zero level and an unread level are the same word, and eight zero
//! skill ids are a legal skillbar shape. Absence is stated, never inferred.
//!
//! **A group that is not certified is not walked.** Each block gates on an
//! anchor offset that cannot legitimately be zero — `world_context`,
//! `world_hero_flags`, and so on. Members like `flag_hero_id` are genuinely
//! `0x00`, so "zero means uncertified" is only sound for the anchors.
//!
//! **The owner filter is not optional.** A hero in `PartyInfo::heroes` may
//! belong to another player in the party; publishing theirs as ours is how a
//! roster silently gains members the player did not add.

use core::ptr::{read_volatile, write_volatile};

use crate::abi::*;
use crate::memory::*;
use crate::{find_player_agent_id, resolve_game, GameState};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut GENERATION: u32 = 0;
static mut DIRTY: bool = true;

/// Matches the toolbox observer's recovery cadence; the two walk the same
/// graph and should not disagree about how stale it may get.
const RECONCILE_TICKS: u32 = 120;

/// One hero the walk resolved, before it is written into a slot.
#[derive(Clone, Copy)]
struct Hero {
    hero_id: u32,
    agent_id: u32,
    level: u32,
    professions: u32,
    behaviour: u32,
    disabled: u32,
    skills: [u32; SKILL_SLOTS],
    attributes: [u32; ATTRIBUTE_SLOTS],
    flags: u32,
}

impl Hero {
    const EMPTY: Self = Self {
        hero_id: 0,
        agent_id: 0,
        level: 0,
        professions: 0,
        behaviour: 0,
        disabled: 0,
        skills: [0; SKILL_SLOTS],
        attributes: [0; ATTRIBUTE_SLOTS],
        flags: 0,
    };
}

fn primary_attribute(profession: u32) -> u32 {
    match profession {
        1 => 17, 2 => 23, 3 => 16, 4 => 6, 5 => 0,
        6 => 12, 7 => 35, 8 => 36, 9 => 40, 10 => 44,
        _ => u32::MAX,
    }
}

fn attribute_profession(id: u32) -> u32 {
    match id {
        17..=21 => 1,
        22..=25 => 2,
        13..=16 => 3,
        4..=7 => 4,
        0..=3 => 5,
        8..=12 => 6,
        29..=31 | 35 => 7,
        32..=34 | 36 => 8,
        37..=40 => 9,
        41..=44 => 10,
        _ => 0,
    }
}

/** Profession pair encoded by the attribute row's admitted ids. */
fn professions_from_attributes(present: &[bool; 45]) -> Option<u32> {
    let mut primary = 0_u32;
    for profession in 1..=10 {
        let id = primary_attribute(profession);
        if present[id as usize] {
            if primary != 0 { return None; }
            primary = profession;
        }
    }
    if primary == 0 { return None; }
    let mut secondary = 0_u32;
    for id in 0..=ATTRIBUTE_ID_MAX {
        if !present[id as usize] { continue; }
        let profession = attribute_profession(id);
        if profession == 0 || profession == primary || id == primary_attribute(profession) {
            continue;
        }
        if secondary != 0 && secondary != profession { return None; }
        secondary = profession;
    }
    Some(primary | (secondary << 8))
}

/// A game array header: buffer, capacity, size, validated together.
///
/// `size > capacity` is the cheapest sign that the address is not an array at
/// all, and it is checked before the buffer is trusted for `size * stride`.
unsafe fn read_array(address: u32, stride: u32, limit: u32) -> Option<(u32, u32)> {
    if stride == 0 || !contains(address, 12) {
        return None;
    }
    let buffer = unsafe { read_u32(address) }?;
    let capacity = offset(address, 4).and_then(|at| unsafe { read_u32(at) })?;
    let size = offset(address, 8).and_then(|at| unsafe { read_u32(at) })?;
    if size > capacity || capacity > limit {
        return None;
    }
    if size == 0 {
        return Some((buffer, 0));
    }
    let bytes = checked_mul(size, stride)?;
    if buffer == 0 || buffer & 3 != 0 || !contains(buffer, bytes) {
        return None;
    }
    Some((buffer, size))
}

unsafe fn field(base: u32, at: u32) -> Option<u32> {
    offset(base, at).and_then(|address| unsafe { read_u32(address) })
}

/// Professions packed as the region carries them, or `None` when either value
/// is outside the ten the client defines. A primary of `None` is a failed read
/// — every character has one — while a secondary of `None` is a real
/// monoclass hero, so only the first is a refusal.
fn pack_professions(primary: u32, secondary: u32) -> Option<u32> {
    if primary == 0 || primary > 10 || secondary > 10 {
        return None;
    }
    Some(primary | (secondary << 8))
}

/// Whether the region already holds exactly this observation.
///
/// The published record *is* the previous walk, in memory this module owns, so
/// there is nothing to keep a second copy of. Reading it back is what lets a
/// walk that found nothing new leave the sequence alone — which is the whole
/// point: `generation` is documented as bumping on a party change, and a
/// reconciliation tick that republishes an identical roster makes that false
/// and every reader downstream re-decode for nothing.
unsafe fn matches_published(
    heroes: &[Hero; PARTY_SLOTS],
    count: u32,
    flags: u32,
    unlock: [u32; 4],
    play_region: u32,
    hard_mode: u32,
) -> bool {
    // SAFETY: as `publish` — the region `companion_init` accepted, written only
    // by this module, and never read here before `initialize` has zeroed it.
    let region = unsafe { POINTER as *const PartySnapshot };
    unsafe {
        if read_volatile(&(*region).flags) != flags
            || read_volatile(&(*region).slot_count) != count
            || read_volatile(&(*region).unlocked_low) != unlock[0]
            || read_volatile(&(*region).unlocked_high) != unlock[1]
            || read_volatile(&(*region).unlock_known_low) != unlock[2]
            || read_volatile(&(*region).unlock_known_high) != unlock[3]
            || read_volatile(&(*region).play_region) != play_region
            || read_volatile(&(*region).hard_mode) != hard_mode
        {
            return false;
        }
        for index in 0..PARTY_SLOTS {
            let slot = &(*region).slots[index];
            let hero = heroes[index];
            if read_volatile(&slot.hero_id) != hero.hero_id
                || read_volatile(&slot.agent_id) != hero.agent_id
                || read_volatile(&slot.professions) != hero.professions
                || read_volatile(&slot.level) != hero.level
                || read_volatile(&slot.behaviour) != hero.behaviour
                || read_volatile(&slot.flags) != hero.flags
                || read_volatile(&slot.disabled) != hero.disabled
            {
                return false;
            }
            for skill in 0..SKILL_SLOTS {
                if read_volatile(&slot.skills[skill]) != hero.skills[skill] {
                    return false;
                }
            }
            for entry in 0..ATTRIBUTE_SLOTS {
                if read_volatile(&slot.attributes[entry]) != hero.attributes[entry] {
                    return false;
                }
            }
        }
    }
    true
}

unsafe fn publish(
    heroes: &[Hero; PARTY_SLOTS],
    count: u32,
    flags: u32,
    unlock: [u32; 4],
    play_region: u32,
    hard_mode: u32,
) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    // SAFETY: `POINTER` is the region `companion_init` accepted through
    // `valid_region` for `FEATURE_TOOLBOX_FOUNDATION` — non-null, aligned, and
    // exactly `PARTY_BYTES` inside linear memory, which cannot shrink.
    let region = unsafe { POINTER as *mut PartySnapshot };
    unsafe {
        write_volatile(&mut (*region).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*region).magic, PARTY_MAGIC);
        write_volatile(&mut (*region).abi_and_size, PARTY_ABI_AND_SIZE);
        write_volatile(&mut (*region).flags, flags);
        write_volatile(&mut (*region).generation, GENERATION);
        write_volatile(&mut (*region).slot_count, count);
        write_volatile(&mut (*region).unlocked_low, unlock[0]);
        write_volatile(&mut (*region).unlocked_high, unlock[1]);
        write_volatile(&mut (*region).unlock_known_low, unlock[2]);
        write_volatile(&mut (*region).unlock_known_high, unlock[3]);
        write_volatile(&mut (*region).play_region, play_region);
        write_volatile(&mut (*region).hard_mode, hard_mode);
        for index in 0..PARTY_SLOTS {
            let slot = &mut (*region).slots[index];
            let hero = heroes[index];
            write_volatile(&mut slot.hero_id, hero.hero_id);
            write_volatile(&mut slot.agent_id, hero.agent_id);
            write_volatile(&mut slot.professions, hero.professions);
            write_volatile(&mut slot.level, hero.level);
            write_volatile(&mut slot.behaviour, hero.behaviour);
            write_volatile(&mut slot.flags, hero.flags);
            write_volatile(&mut slot.disabled, hero.disabled);
            for skill in 0..SKILL_SLOTS {
                write_volatile(&mut slot.skills[skill], hero.skills[skill]);
            }
            for entry in 0..ATTRIBUTE_SLOTS {
                write_volatile(&mut slot.attributes[entry], hero.attributes[entry]);
            }
        }
        write_volatile(&mut (*region).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
        GENERATION = 0;
        DIRTY = true;
    }
    // SAFETY: the caller's validated `PARTY_BYTES` region. Zeroed before the
    // first publish so a reader cannot decode whatever the allocator left.
    for index in 0..PARTY_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe {
        publish(
            &[Hero::EMPTY; PARTY_SLOTS],
            0,
            0,
            [0; 4],
            PLAY_REGION_UNKNOWN,
            0,
        )
    };
}

/// Walks the roster, then fills in whatever the certified layout reaches.
///
/// Returns `None` for any rejection at all. A partly-walked party is the one
/// thing this must never publish: half a roster is indistinguishable from a
/// small one, and the interface would present it as the party.
unsafe fn collect(
    layout: Layout,
) -> Option<([Hero; PARTY_SLOTS], u32, u32, [u32; 4], u32, u32)> {
    let (game, player_number, instance_type, play_region) = match unsafe { resolve_game(layout) } {
        GameState::Ready {
            game,
            player_number,
            instance_type,
            play_region,
            ..
        } => (game, player_number, instance_type, play_region),
        GameState::Loading | GameState::Unavailable => return None,
    };
    if play_region != PLAY_REGION_PVE {
        return Some(([Hero::EMPTY; PARTY_SLOTS], 0, 0, [0; 4], play_region, 0));
    }

    // -- roster, from the offsets certified before this work --------------
    if layout.hero_member_stride < 12 || layout.hero_member_stride > 64 {
        return None;
    }
    let party = offset(game, layout.party_context)
        .and_then(|at| unsafe { pointer(at, checked_add(layout.player_party, 4)?) })?;
    let info = offset(party, layout.player_party)
        .and_then(|at| unsafe { pointer(at, checked_add(layout.party_heroes, 12)?) })?;
    let hard_mode = unsafe { field(party, layout.party_flag) }? & 0x10;
    let (buffer, size) = unsafe {
        read_array(
            offset(info, layout.party_heroes)?,
            layout.hero_member_stride,
            64,
        )
    }?;

    let mut heroes = [Hero::EMPTY; PARTY_SLOTS];
    heroes[0].agent_id = unsafe { find_player_agent_id(layout, player_number) }?;
    heroes[0].flags = SLOT_OCCUPIED;
    let mut count = 0_u32;
    for index in 0..size {
        let member = indexed(buffer, index, layout.hero_member_stride)?;
        // Not ours: another player's hero in a shared party.
        if unsafe { field(member, layout.hero_owner_player_id) }? != player_number {
            continue;
        }
        let hero_id = unsafe { field(member, layout.hero_id) }?;
        if !(1..=39).contains(&hero_id) {
            return None;
        }
        // Slot 0 is the player, who is not a hero, so the roster starts at 1
        // and a full hero party is seven.
        if count as usize + 1 >= PARTY_SLOTS {
            return None;
        }
        let slot = count as usize + 1;
        heroes[slot].hero_id = hero_id;
        heroes[slot].agent_id = unsafe { field(member, layout.hero_agent_id) }?;
        heroes[slot].flags = SLOT_OCCUPIED;
        if layout.hero_level != 0 {
            heroes[slot].level = unsafe { field(member, layout.hero_level) }?;
        }
        count += 1;
    }

    let mut flags = FLAG_ROSTER_OBSERVED | FLAG_HARD_MODE_OBSERVED
        | if instance_type == 0 { FLAG_IN_OUTPOST } else { 0 };
    let mut unlock = [0_u32; 4];

    // -- everything below hangs off WorldContext, and is skipped whole when
    //    the layout does not carry it -------------------------------------
    let world = if layout.world_context == 0 {
        None
    } else {
        offset(game, layout.world_context).and_then(|at| unsafe { pointer(at, 4) })
    };
    let Some(world) = world else {
        return Some((heroes, count, flags, unlock, play_region, u32::from(hard_mode != 0)));
    };

    // hero_info: the account's unlock table, and where professions live.
    if layout.world_hero_info != 0 && layout.hero_info_stride != 0 {
        let (buffer, size) = unsafe {
            read_array(
                offset(world, layout.world_hero_info)?,
                layout.hero_info_stride,
                64,
            )
        }?;
        for index in 0..size {
            let entry = indexed(buffer, index, layout.hero_info_stride)?;
            let hero_id = unsafe { field(entry, layout.info_hero_id) }?;
            if !(1..=63).contains(&hero_id) {
                return None;
            }
            // Presence means unlocked -- except mercenaries, whose rule needs
            // the current character's name. Those are left *unknown* rather
            // than claimed either way, which is what the second bitmap is for.
            let word = (hero_id / 32) as usize;
            let bit = 1_u32 << (hero_id % 32);
            let mercenary = (28..=35).contains(&hero_id);
            if !mercenary {
                unlock[word] |= bit;
                unlock[2 + word] |= bit;
            }
            // Professions reach the roster by hero id: the party member does
            // not carry them, and this record does.
            if layout.info_primary != 0 {
                let packed = pack_professions(
                    unsafe { field(entry, layout.info_primary) }?,
                    unsafe { field(entry, layout.info_secondary) }?,
                );
                if let Some(packed) = packed {
                    for hero in heroes.iter_mut() {
                        if hero.flags & SLOT_OCCUPIED != 0 && hero.hero_id == hero_id {
                            hero.professions = packed;
                            hero.flags |= SLOT_PROFESSIONS;
                        }
                    }
                }
            }
        }
        flags |= FLAG_UNLOCK_OBSERVED;
    }

    // hero_flags: behaviour, keyed by hero id.
    if layout.world_hero_flags != 0 && layout.hero_flag_stride != 0 {
        let (buffer, size) = unsafe {
            read_array(
                offset(world, layout.world_hero_flags)?,
                layout.hero_flag_stride,
                64,
            )
        }?;
        for index in 0..size {
            let entry = indexed(buffer, index, layout.hero_flag_stride)?;
            let hero_id = unsafe { field(entry, layout.flag_hero_id) }?;
            let behaviour = unsafe { field(entry, layout.flag_behavior) }?;
            if behaviour > 2 {
                continue;
            }
            for hero in heroes.iter_mut() {
                if hero.flags & SLOT_OCCUPIED != 0 && hero.hero_id == hero_id {
                    hero.behaviour = behaviour;
                    hero.flags |= SLOT_BEHAVIOUR;
                }
            }
        }
    }

    // skillbars: keyed by agent id, which is why the roster reads it first.
    if layout.world_skillbars != 0 && layout.skillbar_stride != 0 {
        let (buffer, size) = unsafe {
            read_array(
                offset(world, layout.world_skillbars)?,
                layout.skillbar_stride,
                64,
            )
        }?;
        for index in 0..size {
            let entry = indexed(buffer, index, layout.skillbar_stride)?;
            let agent_id = unsafe { field(entry, layout.skillbar_agent_id) }?;
            // `Skillbar::IsValid()` is `agent_id > 0`. An empty entry is not a
            // bar of eight blanks; it is not a bar.
            if agent_id == 0 {
                continue;
            }
            for hero in heroes.iter_mut() {
                if hero.flags & SLOT_OCCUPIED == 0 || hero.agent_id != agent_id {
                    continue;
                }
                for slot in 0..SKILL_SLOTS {
                    let at = checked_add(
                        layout.skillbar_skills,
                        checked_mul(slot as u32, layout.skill_slot_stride)?,
                    )?;
                    hero.skills[slot] =
                        unsafe { field(entry, checked_add(at, layout.skill_slot_id)?) }?;
                }
                hero.disabled = unsafe { field(entry, layout.skillbar_disabled) }? & 0xff;
                hero.flags |= SLOT_SKILLS;
            }
        }
    }

    // attributes: keyed by agent id like the skillbars, and the reason a
    // captured build can be published as a template at all — a bar written out
    // with every attribute at rank 0 is a bar the character cannot use.
    if layout.world_attributes != 0 && layout.attribute_stride != 0 {
        let (buffer, size) = unsafe {
            read_array(
                offset(world, layout.world_attributes)?,
                layout.attribute_stride,
                64,
            )
        }?;
        for index in 0..size {
            let entry = indexed(buffer, index, layout.attribute_stride)?;
            let agent_id = unsafe { field(entry, layout.attribute_agent_id) }?;
            if agent_id == 0 {
                continue;
            }
            for hero in heroes.iter_mut() {
                if hero.flags & SLOT_OCCUPIED == 0 || hero.agent_id != agent_id {
                    continue;
                }
                let mut written = 0_usize;
                let mut present = [false; 45];
                for id in 0..=ATTRIBUTE_ID_MAX {
                    let at = checked_add(
                        layout.attribute_entries,
                        checked_mul(id, layout.attribute_entry_stride)?,
                    )?;
                    // The array is sparse and indexed by attribute id, so this
                    // equality is what says the entry is an attribute at all.
                    // Without it the walk reads whatever the reference struct's
                    // padding holds past id 44 — which on a live client decodes
                    // as Air Magic at rank 8 on a Warrior.
                    if unsafe { field(entry, checked_add(at, layout.attribute_entry_id)?) }? != id {
                        continue;
                    }
                    present[id as usize] = true;
                    let rank =
                        unsafe { field(entry, checked_add(at, layout.attribute_entry_rank)?) }?;
                    // 12 is what the client's own cost table can buy. Nothing
                    // invested is not published: an absent attribute already
                    // means rank zero on the other side.
                    if rank == 0 {
                        continue;
                    }
                    if rank > 12 {
                        return None;
                    }
                    // More than a character can have means this is not the
                    // table we think it is, and a truncated list of ranks is a
                    // build that looks complete and is not.
                    if written >= ATTRIBUTE_SLOTS {
                        return None;
                    }
                    hero.attributes[written] = id | (rank << 8);
                    written += 1;
                }
                hero.flags |= SLOT_ATTRIBUTES;
                if hero.hero_id == 0 {
                    if let Some(professions) = professions_from_attributes(&present) {
                        hero.professions = professions;
                        hero.flags |= SLOT_PROFESSIONS;
                    }
                }
            }
        }
    }

    Some((heroes, count, flags, unlock, play_region, u32::from(hard_mode != 0)))
}

/// Armed by the same certified UI messages that dirty the toolbox projection.
///
/// Its own flag rather than a read of the toolbox module's: both are set from
/// one `observe_ui` call, so neither depends on the other having run first,
/// and a walk here cannot be skipped because a walk there happened to clear
/// the flag earlier in the same tick.
pub(crate) unsafe fn mark_dirty() {
    unsafe { DIRTY = true };
}

/// Walks only when the party graph was disturbed, or once every
/// `RECONCILE_TICKS` as the missed-event recovery path. A per-frame traversal
/// of eight heroes, three arrays and sixty-four skill ids is not something to
/// do because nothing happened.
///
/// And a walk that found nothing new publishes nothing. The reconciliation tick
/// exists to catch changes no certified message announced — a hero's skill bar
/// being edited is exactly that — so it fires regardless of `DIRTY` and would
/// otherwise bump the sequence twice a second forever. Leaving the record alone
/// is what makes "the sequence moved" mean "the party changed" to every reader
/// downstream, which is the only cheap question they can ask.
pub(crate) unsafe fn tick_if_dirty(layout: Layout, tick_count: u32) {
    if !unsafe { DIRTY } && tick_count.wrapping_sub(1) % RECONCILE_TICKS != 0 {
        return;
    }
    unsafe { DIRTY = false };
    let observation = unsafe { collect(layout) };
    let (heroes, count, flags, unlock, play_region, hard_mode) = observation.unwrap_or((
        [Hero::EMPTY; PARTY_SLOTS],
        0,
        0,
        [0; 4],
        PLAY_REGION_UNKNOWN,
        0,
    ));
    if unsafe { matches_published(&heroes, count, flags, unlock, play_region, hard_mode) } {
        return;
    }
    unsafe {
        GENERATION = GENERATION.wrapping_add(1);
        publish(&heroes, count, flags, unlock, play_region, hard_mode);
    }
}
