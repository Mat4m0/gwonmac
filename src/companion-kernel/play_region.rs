//! Bounded publication of the current PvE/PvP policy fact.
//!
//! This observer deliberately stops at the character context and one indexed
//! area-table record. It never opens the agent array, so Travel-only recovery
//! cannot inherit the full snapshot's player scan.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::character_identity::character_key;
use crate::memory::{checked_add, checked_mul, contains, indexed, offset, pointer, read_u32};
use crate::{resolve_game, GameState};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;

unsafe fn publish(
    flags: u32,
    map_id: u32,
    instance_type: u32,
    play_region: u32,
    character_key: u64,
    unlocked_maps: [u32; TRAVEL_UNLOCK_WORDS],
) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut PlayRegionSnapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, PLAY_REGION_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, PLAY_REGION_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, flags);
        write_volatile(&mut (*snapshot).map_id, map_id);
        write_volatile(&mut (*snapshot).instance_type, instance_type);
        write_volatile(&mut (*snapshot).play_region, play_region);
        write_volatile(&mut (*snapshot).character_key_low, character_key as u32);
        write_volatile(
            &mut (*snapshot).character_key_high,
            (character_key >> 32) as u32,
        );
        for (index, word) in unlocked_maps.iter().enumerate() {
            write_volatile(&mut (*snapshot).unlocked_maps[index], *word);
        }
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
    }
    for index in 0..PLAY_REGION_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish(0, 0, 0, 0, 0, [0; TRAVEL_UNLOCK_WORDS]) };
}

/** Reads the certified WorldContext Array<u32>; `None` publishes unknown. */
unsafe fn observe_travel_unlocks(layout: Layout, game: u32) -> Option<[u32; TRAVEL_UNLOCK_WORDS]> {
    if game == 0 || layout.world_context == 0 || layout.world_unlocked_maps == 0 {
        return None;
    }
    let world_required = checked_add(layout.world_unlocked_maps, 12)?;
    let world =
        offset(game, layout.world_context).and_then(|at| unsafe { pointer(at, world_required) })?;
    let array = offset(world, layout.world_unlocked_maps)?;
    let buffer = unsafe { read_u32(array) }?;
    let capacity = offset(array, 4).and_then(|at| unsafe { read_u32(at) })?;
    let size = offset(array, 8).and_then(|at| unsafe { read_u32(at) })?;
    if buffer == 0
        || buffer & 3 != 0
        || size > capacity
        || capacity > 64
        || !contains(buffer, checked_mul(size, 4)?)
    {
        return None;
    }
    let mut words = [0; TRAVEL_UNLOCK_WORDS];
    // Native arrays may be shorter on new accounts. Missing words mean locked.
    for (index, word) in words
        .iter_mut()
        .take(core::cmp::min(size as usize, TRAVEL_UNLOCK_WORDS))
        .enumerate()
    {
        *word = unsafe { read_u32(indexed(buffer, index as u32, 4)?)? };
    }
    Some(words)
}

unsafe fn current_character_key(layout: Layout, game: u32) -> Option<u64> {
    if layout.character_uuid == 0 {
        return None;
    }
    let required = checked_add(layout.character_uuid, 16)?;
    let character =
        offset(game, layout.character_context).and_then(|at| unsafe { pointer(at, required) })?;
    let uuid = offset(character, layout.character_uuid)?;
    unsafe { character_key(uuid) }
}

unsafe fn has_guild_hall(layout: Layout) -> bool {
    if layout.guild_context_slot == 0 || layout.guild_hall_key == 0 {
        return false;
    }
    let Some(contexts) = (unsafe { pointer(layout.context_root, 28) }) else {
        return false;
    };
    let Some(slot) = indexed(contexts, layout.guild_context_slot, 4) else {
        return false;
    };
    let Some(required) = checked_add(layout.guild_hall_key, 16) else {
        return false;
    };
    let Some(guild) = (unsafe { pointer(slot, required) }) else {
        return false;
    };
    (0..4).any(|index| {
        offset(guild, layout.guild_hall_key + index * 4)
            .and_then(|at| unsafe { read_u32(at) })
            .is_some_and(|word| word != 0)
    })
}

pub(crate) unsafe fn tick(layout: Layout) {
    match unsafe { resolve_game(layout) } {
        GameState::Ready {
            game,
            map_id,
            instance_type,
            play_region,
            pre_searing,
            guild_hall,
            ..
        } if play_region == PLAY_REGION_PVE || play_region == PLAY_REGION_PVP => unsafe {
            let key = current_character_key(layout, game);
            let unlocks = observe_travel_unlocks(layout, game);
            let flags = FLAG_PLAY_REGION_READY
                | if key.is_some() {
                    FLAG_PLAY_REGION_CHARACTER
                } else {
                    0
                }
                | if unlocks.is_some() {
                    FLAG_PLAY_REGION_UNLOCKS
                } else {
                    0
                }
                | if pre_searing {
                    FLAG_PLAY_REGION_PRE_SEARING
                } else {
                    0
                }
                | if guild_hall { FLAG_PLAY_REGION_GUILD_HALL } else { 0 }
                | if has_guild_hall(layout) { FLAG_PLAY_REGION_HAS_GUILD_HALL } else { 0 };
            publish(
                flags,
                map_id,
                instance_type,
                play_region,
                key.unwrap_or(0),
                unlocks.unwrap_or([0; TRAVEL_UNLOCK_WORDS]),
            );
        },
        GameState::Loading => unsafe {
            publish(
                FLAG_PLAY_REGION_LOADING,
                0,
                0,
                0,
                0,
                [0; TRAVEL_UNLOCK_WORDS],
            );
        },
        GameState::Ready { .. } | GameState::Unavailable => unsafe {
            publish(0, 0, 0, 0, 0, [0; TRAVEL_UNLOCK_WORDS]);
        },
    }
}
