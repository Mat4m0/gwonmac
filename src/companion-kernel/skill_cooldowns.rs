//! Bounded, read-only observation of the player's eight authoritative skill
//! recharge timestamps. Stable player and skillbar identities are cached; the
//! bounded table is scanned when identity validation fails and periodically to
//! detect new ambiguity. Publication is all-or-nothing and sequence protected.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::memory::*;
use crate::{find_player_agent, resolve_game, GameState};

const MAX_RECHARGE_MS: u32 = 1_800_000;
const MAX_SKILLBARS: u32 = 64;
// The cached player row is validated every tick. Re-audit the complete bounded
// table twice a second so a newly duplicated player row cannot remain hidden
// behind an otherwise valid cache entry.
const CACHE_AUDIT_TICKS: u32 = 30;

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut GENERATION: u32 = 0;
static mut PLAYER_NUMBER: u32 = 0;
static mut PLAYER_AGENT_ID: u32 = 0;
static mut SKILLBAR_BUFFER: u32 = 0;
static mut SKILLBAR_INDEX: u32 = u32::MAX;
static mut SKILLBAR_SIZE: u32 = 0;
static mut CACHE_AGE: u32 = CACHE_AUDIT_TICKS;

unsafe fn invalidate_skillbar_cache() {
    unsafe {
        SKILLBAR_BUFFER = 0;
        SKILLBAR_INDEX = u32::MAX;
        SKILLBAR_SIZE = 0;
        CACHE_AGE = CACHE_AUDIT_TICKS;
    }
}

enum Collected {
    Ready(u32, [u32; SKILL_SLOTS]),
    Loading,
    Unavailable,
}

unsafe fn player_is_still_valid(layout: Layout, player_number: u32, agent_id: u32) -> bool {
    if agent_id == 0 || !contains(layout.agent_array, 12) {
        return false;
    }
    let Some(buffer) = (unsafe { read_u32(layout.agent_array) }) else { return false };
    let Some(capacity) = offset(layout.agent_array, 4)
        .and_then(|at| unsafe { read_u32(at) }) else { return false };
    let Some(size) = offset(layout.agent_array, 8).and_then(|at| unsafe { read_u32(at) }) else {
        return false;
    };
    if agent_id >= size
        || size > capacity
        || capacity > 4_096
        || buffer == 0
        || buffer & 3 != 0
        || !contains(buffer, size.saturating_mul(4))
    {
        return false;
    }
    let required = layout
        .agent_model_type
        .checked_add(2)
        .unwrap_or(u32::MAX)
        .max(layout.agent_id.saturating_add(4))
        .max(layout.agent_player_number.saturating_add(2));
    let Some(agent) = indexed(buffer, agent_id, 4)
        .and_then(|at| unsafe { pointer(at, required) }) else { return false };
    let Some(id_at) = offset(agent, layout.agent_id) else { return false };
    let Some(player_at) = offset(agent, layout.agent_player_number) else { return false };
    let Some(model_at) = offset(agent, layout.agent_model_type) else { return false };
    (unsafe { read_u32(id_at) }) == Some(agent_id)
        && (unsafe { read_u16(player_at) })
            == Some(player_number as u16)
        && (unsafe { read_u16(model_at) })
            .is_some_and(|value| value & 0xf000 == 0x3000)
}

unsafe fn player_agent(layout: Layout, player_number: u32) -> Option<u32> {
    let cached_number = unsafe { PLAYER_NUMBER };
    let cached_id = unsafe { PLAYER_AGENT_ID };
    if cached_number == player_number
        && unsafe { player_is_still_valid(layout, player_number, cached_id) }
    {
        return Some(cached_id);
    }
    let found = unsafe { find_player_agent(layout, player_number) }?;
    unsafe {
        PLAYER_NUMBER = player_number;
        PLAYER_AGENT_ID = found;
        invalidate_skillbar_cache();
    }
    Some(found)
}

fn valid_layout(layout: Layout) -> bool {
    if layout.skillbar_stride == 0
        || layout.skillbar_stride > 512
        || layout.skill_slot_stride == 0
        || layout.skill_slot_stride > 64
        || layout.skillbar_agent_id.saturating_add(4) > layout.skillbar_stride
    {
        return false;
    }
    let Some(last_slot) = checked_mul((SKILL_SLOTS - 1) as u32, layout.skill_slot_stride)
        .and_then(|value| checked_add(layout.skillbar_skills, value))
        .and_then(|value| checked_add(value, layout.skill_slot_recharge))
        .and_then(|value| checked_add(value, 4)) else { return false };
    last_slot <= layout.skillbar_stride
}

unsafe fn skillbar_array(layout: Layout, game: u32) -> Option<(u32, u32)> {
    if !valid_layout(layout) {
        return None;
    }
    let world_required = checked_add(layout.world_skillbars, 12)?;
    let world = offset(game, layout.world_context)
        .and_then(|at| unsafe { pointer(at, world_required) })?;
    let header = offset(world, layout.world_skillbars)?;
    let buffer = unsafe { read_u32(header) }?;
    let capacity = offset(header, 4).and_then(|at| unsafe { read_u32(at) })?;
    let size = offset(header, 8).and_then(|at| unsafe { read_u32(at) })?;
    if size == 0 || size > capacity || capacity > MAX_SKILLBARS || buffer == 0 || buffer & 3 != 0 {
        return None;
    }
    contains(buffer, checked_mul(size, layout.skillbar_stride)?).then_some((buffer, size))
}

unsafe fn row_for_player(
    layout: Layout,
    buffer: u32,
    size: u32,
    player_agent_id: u32,
) -> Option<u32> {
    let cached_buffer = unsafe { SKILLBAR_BUFFER };
    let cached_index = unsafe { SKILLBAR_INDEX };
    if cached_buffer == buffer
        && unsafe { SKILLBAR_SIZE } == size
        && cached_index < size
        && unsafe { CACHE_AGE } < CACHE_AUDIT_TICKS
    {
        let row = indexed(buffer, cached_index, layout.skillbar_stride)?;
        if unsafe { read_u32(offset(row, layout.skillbar_agent_id)?) } == Some(player_agent_id) {
            unsafe { CACHE_AGE = CACHE_AGE.saturating_add(1) };
            return Some(row);
        }
    }

    let mut found = None;
    let mut found_index = 0;
    for index in 0..size {
        let row = indexed(buffer, index, layout.skillbar_stride)?;
        if unsafe { read_u32(offset(row, layout.skillbar_agent_id)?) } == Some(player_agent_id) {
            if found.is_some() {
                return None;
            }
            found = Some(row);
            found_index = index;
        }
    }
    let row = found?;
    unsafe {
        if SKILLBAR_BUFFER != buffer || SKILLBAR_INDEX != found_index {
            GENERATION = GENERATION.wrapping_add(1);
        }
        SKILLBAR_BUFFER = buffer;
        SKILLBAR_INDEX = found_index;
        SKILLBAR_SIZE = size;
        CACHE_AGE = 0;
    }
    Some(row)
}

unsafe fn collect(layout: Layout, game_timer: u32) -> Collected {
    let (game, player_number, play_region) = match unsafe { resolve_game(layout) } {
        GameState::Ready { game, player_number, play_region, .. } => {
            (game, player_number, play_region)
        }
        GameState::Loading => return Collected::Loading,
        GameState::Unavailable => return Collected::Unavailable,
    };
    if play_region != PLAY_REGION_PVE {
        return Collected::Unavailable;
    }
    let Some(player_agent_id) = (unsafe { player_agent(layout, player_number) }) else {
        return Collected::Unavailable;
    };
    let Some((buffer, size)) = (unsafe { skillbar_array(layout, game) }) else {
        unsafe { invalidate_skillbar_cache() };
        return Collected::Unavailable;
    };
    let Some(row) = (unsafe { row_for_player(layout, buffer, size, player_agent_id) }) else {
        return Collected::Unavailable;
    };
    let mut timestamps = [0; SKILL_SLOTS];
    for (slot, timestamp) in timestamps.iter_mut().enumerate() {
        let Some(at) = checked_add(
            layout.skillbar_skills,
            match checked_mul(slot as u32, layout.skill_slot_stride) {
                Some(value) => value,
                None => return Collected::Unavailable,
            },
        )
        .and_then(|value| checked_add(value, layout.skill_slot_recharge)) else {
            return Collected::Unavailable;
        };
        let Some(address) = offset(row, at) else { return Collected::Unavailable };
        let Some(value) = (unsafe { read_u32(address) }) else {
            return Collected::Unavailable;
        };
        *timestamp = value;
        if *timestamp != 0 && timestamp.wrapping_sub(game_timer) > MAX_RECHARGE_MS {
            return Collected::Unavailable;
        }
    }
    Collected::Ready(player_agent_id, timestamps)
}

unsafe fn publish(flags: u32, game_timer: u32, player_agent_id: u32, timestamps: [u32; 8]) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut SkillCooldownSnapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, SKILL_COOLDOWN_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, SKILL_COOLDOWN_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, flags);
        write_volatile(&mut (*snapshot).generation, GENERATION);
        write_volatile(&mut (*snapshot).game_timer, game_timer);
        write_volatile(&mut (*snapshot).player_agent_id, player_agent_id);
        for (index, value) in timestamps.iter().enumerate() {
            write_volatile(&mut (*snapshot).recharge_timestamps[index], *value);
        }
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
        GENERATION = 0;
        PLAYER_NUMBER = 0;
        PLAYER_AGENT_ID = 0;
        invalidate_skillbar_cache();
    }
    for index in 0..SKILL_COOLDOWN_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish(0, 0, 0, [0; SKILL_SLOTS]) };
}

pub(crate) unsafe fn tick(layout: Layout, game_timer: u32) {
    match unsafe { collect(layout, game_timer) } {
        Collected::Ready(player, timestamps) => unsafe {
            publish(FLAG_SKILL_COOLDOWNS_READY, game_timer, player, timestamps)
        },
        Collected::Loading => unsafe {
            publish(FLAG_SKILL_COOLDOWNS_LOADING, 0, 0, [0; SKILL_SLOTS])
        },
        Collected::Unavailable => unsafe { publish(0, 0, 0, [0; SKILL_SLOTS]) },
    }
}
