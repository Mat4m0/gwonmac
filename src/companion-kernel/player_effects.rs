//! Bounded, read-only projection of the controlled player's authoritative
//! timed-effect collection. UI messages only mark the projection dirty; the
//! array remains the source of truth and is reconciled at least every 30 ticks.

use core::ptr::{read_volatile, write_volatile};

use crate::abi::*;
use crate::memory::*;
use crate::{find_player_agent, resolve_game, GameState};

const MAX_AGENT_EFFECT_ROWS: u32 = 64;
const RECONCILE_TICKS: u32 = 30;
const HEARTBEAT_TICKS: u32 = 6;
const MAX_DURATION_SECONDS: f32 = 2_592_000.0;
const EMPTY: PlayerEffectRecord = PlayerEffectRecord {
    effect_id: 0,
    skill_id: 0,
    attribute_level: 0,
    maintainer_agent_id: 0,
    duration_ms: 0,
    applied_at_game_ms: 0,
};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut GENERATION: u32 = 0;
static mut DIRTY: bool = true;
static mut LAST_RECONCILE: u32 = 0;
static mut LAST_PUBLISH: u32 = 0;
static mut CACHED_PLAYER: u32 = 0;
static mut CACHED_COUNT: u32 = 0;
static mut OUTCOME: u32 = 0;
static mut CACHED: [PlayerEffectRecord; EFFECT_RECORDS] = [EMPTY; EFFECT_RECORDS];

#[repr(u32)]
#[derive(Clone, Copy)]
enum Outcome {
    GameState = 1,
    PolicyOrLayout = 2,
    PlayerAgent = 3,
    ContextTable = 4,
    WorldContext = 5,
    OuterHeader = 6,
    OuterArray = 7,
    PlayerRow = 8,
    EffectsHeader = 9,
    Overflow = 10,
    EffectRecord = 11,
    Inactive = 12,
}

enum Collected {
    Ready(u32, u32, [PlayerEffectRecord; EFFECT_RECORDS]),
    Loading,
    Unavailable(Outcome),
}

unsafe fn cached(index: usize) -> PlayerEffectRecord {
    unsafe { read_volatile(core::ptr::addr_of!(CACHED).cast::<PlayerEffectRecord>().add(index)) }
}

fn valid_layout(layout: Layout) -> bool {
    layout.world_context != 0
        && layout.world_party_effects != 0
        && (24..=128).contains(&layout.agent_effects_stride)
        && layout.agent_effects_agent_id.saturating_add(4) <= layout.agent_effects_stride
        && layout.agent_effects_effects.saturating_add(12) <= layout.agent_effects_stride
        && (24..=64).contains(&layout.effect_stride)
        && [
            layout.effect_skill_id,
            layout.effect_attribute_level,
            layout.effect_id,
            layout.effect_maintainer_agent_id,
            layout.effect_duration,
            layout.effect_timestamp,
        ]
        .iter()
        .all(|field| field & 3 == 0 && field.saturating_add(4) <= layout.effect_stride)
}

unsafe fn collect(layout: Layout) -> Collected {
    let (player_number, play_region) = match unsafe { resolve_game(layout) } {
        GameState::Ready { player_number, play_region, .. } => {
            (player_number, play_region)
        }
        GameState::Loading => return Collected::Loading,
        GameState::Unavailable => return Collected::Unavailable(Outcome::GameState),
    };
    if play_region != PLAY_REGION_PVE || !valid_layout(layout) {
        return Collected::Unavailable(Outcome::PolicyOrLayout);
    }
    let Some(player_agent_id) = (unsafe { find_player_agent(layout, player_number) }) else {
        return Collected::Unavailable(Outcome::PlayerAgent);
    };
    let Some(world_required) = checked_add(layout.world_party_effects, 12) else {
        return Collected::Unavailable(Outcome::PolicyOrLayout);
    };
    let Some(contexts) = (unsafe { pointer(layout.context_root, 28) }) else {
        return Collected::Unavailable(Outcome::ContextTable);
    };
    let Some(game_required) = checked_add(layout.world_context, 4) else {
        return Collected::Unavailable(Outcome::PolicyOrLayout);
    };
    let Some(game) = indexed(contexts, layout.game_context_slot, 4)
        .and_then(|at| unsafe { pointer(at, game_required) }) else {
        return Collected::Unavailable(Outcome::ContextTable);
    };
    let Some(world) = offset(game, layout.world_context)
        .and_then(|at| unsafe { pointer(at, world_required) }) else {
        return Collected::Unavailable(Outcome::WorldContext);
    };
    let Some(header) = offset(world, layout.world_party_effects) else {
        return Collected::Unavailable(Outcome::OuterHeader);
    };
    let Some(buffer) = (unsafe { read_u32(header) }) else { return Collected::Unavailable(Outcome::OuterHeader) };
    let Some(capacity) = offset(header, 4).and_then(|at| unsafe { read_u32(at) }) else {
        return Collected::Unavailable(Outcome::OuterHeader);
    };
    let Some(size) = offset(header, 8).and_then(|at| unsafe { read_u32(at) }) else {
        return Collected::Unavailable(Outcome::OuterHeader);
    };
    if size > capacity || capacity > MAX_AGENT_EFFECT_ROWS {
        return Collected::Unavailable(Outcome::OuterArray);
    }
    // AgentEffects rows are sparse: an agent with no effects may have no row
    // at all. An empty outer array is therefore authoritative empty state, not
    // a malformed collection. Its buffer is allowed to be null.
    if size == 0 {
        return Collected::Ready(player_agent_id, 0, [EMPTY; EFFECT_RECORDS]);
    }
    if buffer == 0 || buffer & 3 != 0
        || !contains(buffer, size.saturating_mul(layout.agent_effects_stride))
    {
        return Collected::Unavailable(Outcome::OuterArray);
    }
    let mut player_row = None;
    for index in 0..size {
        let Some(row) = indexed(buffer, index, layout.agent_effects_stride) else {
            return Collected::Unavailable(Outcome::OuterArray);
        };
        let Some(agent_id) = offset(row, layout.agent_effects_agent_id)
            .and_then(|at| unsafe { read_u32(at) }) else {
            return Collected::Unavailable(Outcome::OuterArray);
        };
        if agent_id == player_agent_id {
            if player_row.is_some() { return Collected::Unavailable(Outcome::PlayerRow); }
            player_row = Some(row);
        }
    }
    let Some(row) = player_row else {
        return Collected::Ready(player_agent_id, 0, [EMPTY; EFFECT_RECORDS]);
    };
    let Some(effects_header) = offset(row, layout.agent_effects_effects) else {
        return Collected::Unavailable(Outcome::EffectsHeader);
    };
    let Some(effects_buffer) = (unsafe { read_u32(effects_header) }) else {
        return Collected::Unavailable(Outcome::EffectsHeader);
    };
    let Some(effects_capacity) = offset(effects_header, 4)
        .and_then(|at| unsafe { read_u32(at) }) else { return Collected::Unavailable(Outcome::EffectsHeader) };
    let Some(effect_count) = offset(effects_header, 8)
        .and_then(|at| unsafe { read_u32(at) }) else { return Collected::Unavailable(Outcome::EffectsHeader) };
    // Exceeding the fixed ABI is a refusal, never silent truncation.
    if effect_count > EFFECT_RECORDS as u32 || effect_count > effects_capacity {
        return Collected::Unavailable(Outcome::Overflow);
    }
    if effect_count > 0 && (effects_buffer == 0 || effects_buffer & 3 != 0
        || !contains(effects_buffer, effect_count.saturating_mul(layout.effect_stride)))
    {
        return Collected::Unavailable(Outcome::EffectsHeader);
    }
    let mut records = [EMPTY; EFFECT_RECORDS];
    for index in 0..effect_count {
        let Some(effect) = indexed(effects_buffer, index, layout.effect_stride) else {
            return Collected::Unavailable(Outcome::EffectRecord);
        };
        let read = |field| offset(effect, field).and_then(|at| unsafe { read_u32(at) });
        let Some(skill_id) = read(layout.effect_skill_id) else { return Collected::Unavailable(Outcome::EffectRecord) };
        let Some(attribute_level) = read(layout.effect_attribute_level) else { return Collected::Unavailable(Outcome::EffectRecord) };
        let Some(effect_id) = read(layout.effect_id) else { return Collected::Unavailable(Outcome::EffectRecord) };
        let Some(maintainer_agent_id) = read(layout.effect_maintainer_agent_id) else { return Collected::Unavailable(Outcome::EffectRecord) };
        let Some(duration) = offset(effect, layout.effect_duration)
            .and_then(|at| unsafe { read_f32(at) }) else { return Collected::Unavailable(Outcome::EffectRecord) };
        let Some(timestamp) = read(layout.effect_timestamp) else { return Collected::Unavailable(Outcome::EffectRecord) };
        if skill_id == 0 || effect_id == 0 || attribute_level > 30
            || !duration.is_finite() || duration < 0.0 || duration > MAX_DURATION_SECONDS
        {
            return Collected::Unavailable(Outcome::EffectRecord);
        }
        unsafe { *records.get_unchecked_mut(index as usize) = PlayerEffectRecord {
            effect_id,
            skill_id,
            attribute_level,
            maintainer_agent_id,
            duration_ms: (duration * 1_000.0) as u32,
            applied_at_game_ms: timestamp,
        }; }
    }
    Collected::Ready(player_agent_id, effect_count, records)
}

fn records_changed(player: u32, count: u32, records: &[PlayerEffectRecord; EFFECT_RECORDS]) -> bool {
    if unsafe { CACHED_PLAYER } != player || unsafe { CACHED_COUNT } != count { return true; }
    for index in 0..count as usize {
        let left = unsafe { cached(index) };
        let right = unsafe { *records.get_unchecked(index) };
        if left.effect_id != right.effect_id || left.skill_id != right.skill_id
            || left.attribute_level != right.attribute_level
            || left.maintainer_agent_id != right.maintainer_agent_id
            || left.duration_ms != right.duration_ms
            || left.applied_at_game_ms != right.applied_at_game_ms
        { return true; }
    }
    false
}

unsafe fn publish(flags: u32, game_timer: u32) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut PlayerEffectSnapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, PLAYER_EFFECT_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, PLAYER_EFFECT_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, flags);
        write_volatile(&mut (*snapshot).generation, GENERATION);
        write_volatile(&mut (*snapshot).game_timer, game_timer);
        write_volatile(&mut (*snapshot).count, if flags & FLAG_PLAYER_EFFECTS_READY != 0 { CACHED_COUNT } else { 0 });
        write_volatile(&mut (*snapshot).player_agent_id, if flags & FLAG_PLAYER_EFFECTS_READY != 0 { CACHED_PLAYER } else { 0 });
        write_volatile(&mut (*snapshot).outcome, if flags & FLAG_PLAYER_EFFECTS_READY != 0 || flags & FLAG_PLAYER_EFFECTS_LOADING != 0 { 0 } else { OUTCOME });
        write_volatile(&mut (*snapshot).effects, if flags & FLAG_PLAYER_EFFECTS_READY != 0 { CACHED } else { [EMPTY; EFFECT_RECORDS] });
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer; SEQUENCE = 0; GENERATION = 0; DIRTY = true;
        LAST_RECONCILE = 0; LAST_PUBLISH = 0; CACHED_PLAYER = 0;
        CACHED_COUNT = 0; OUTCOME = 0; CACHED = [EMPTY; EFFECT_RECORDS];
    }
    for index in 0..PLAYER_EFFECT_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish(0, 0) };
}

pub(crate) unsafe fn observe_ui(layout: Layout, message: u32) {
    if layout.effect_dirty_messages.contains(&message) {
        unsafe { DIRTY = true };
    }
}

pub(crate) unsafe fn mark_dirty() {
    unsafe { DIRTY = true };
}

pub(crate) unsafe fn tick(layout: Layout, game_timer: u32, tick: u32) {
    let reconcile = unsafe { DIRTY } || tick.wrapping_sub(unsafe { LAST_RECONCILE }) >= RECONCILE_TICKS;
    let mut flags = if unsafe { CACHED_PLAYER } != 0 { FLAG_PLAYER_EFFECTS_READY } else { 0 };
    if reconcile {
        match unsafe { collect(layout) } {
            Collected::Ready(player, count, records) => unsafe {
                if records_changed(player, count, &records) { GENERATION = GENERATION.wrapping_add(1); }
                CACHED_PLAYER = player; CACHED_COUNT = count; CACHED = records;
                OUTCOME = 0;
                flags = FLAG_PLAYER_EFFECTS_READY;
            },
            Collected::Loading => unsafe { OUTCOME = 0; flags = FLAG_PLAYER_EFFECTS_LOADING; },
            Collected::Unavailable(outcome) => unsafe { OUTCOME = outcome as u32; flags = 0; },
        }
        unsafe { DIRTY = false; LAST_RECONCILE = tick; }
        if flags & FLAG_PLAYER_EFFECTS_READY == 0 {
            unsafe { CACHED_PLAYER = 0; CACHED_COUNT = 0; CACHED = [EMPTY; EFFECT_RECORDS]; }
        }
    }
    if reconcile || tick.wrapping_sub(unsafe { LAST_PUBLISH }) >= HEARTBEAT_TICKS {
        unsafe { publish(flags, game_timer); LAST_PUBLISH = tick; }
    }
}

pub(crate) unsafe fn inactive(game_timer: u32, tick: u32, active_features: u32) {
    unsafe {
        // The low byte remains the stable refusal code. The upper bits are a
        // bounded developer diagnostic of the kernel's accepted feature mask;
        // no pointers or client memory leave the kernel.
        OUTCOME = Outcome::Inactive as u32 | (active_features << 8);
        CACHED_PLAYER = 0;
        CACHED_COUNT = 0;
        CACHED = [EMPTY; EFFECT_RECORDS];
    }
    if tick.wrapping_sub(unsafe { LAST_PUBLISH }) >= HEARTBEAT_TICKS {
        unsafe { publish(0, game_timer); LAST_PUBLISH = tick; }
    }
}

pub(crate) unsafe fn current_skills() -> (u32, [u32; EFFECT_RECORDS]) {
    let mut skills = [0; EFFECT_RECORDS];
    let count = unsafe { CACHED_COUNT };
    for index in 0..count as usize {
        unsafe { *skills.get_unchecked_mut(index) = cached(index).skill_id; }
    }
    (count, skills)
}

pub(crate) unsafe fn current_generation() -> u32 {
    unsafe { GENERATION }
}
