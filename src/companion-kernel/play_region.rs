//! Bounded publication of the current PvE/PvP policy fact.
//!
//! This observer deliberately stops at the character context and one indexed
//! area-table record. It never opens the agent array, so Travel-only recovery
//! cannot inherit the full snapshot's player scan.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::memory::{checked_add, contains, offset, pointer, read_u32};
use crate::{observe_travel_unlocks, resolve_game, GameState};

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

unsafe fn character_key(layout: Layout, game: u32) -> Option<u64> {
    if layout.character_uuid == 0 {
        return None;
    }
    let required = checked_add(layout.character_uuid, 16)?;
    let character = offset(game, layout.character_context)
        .and_then(|at| unsafe { pointer(at, required) })?;
    let uuid = offset(character, layout.character_uuid)?;
    if !contains(uuid, 16) {
        return None;
    }
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut nonzero = 0_u32;
    for index in 0..4_u32 {
        let word = unsafe { read_u32(offset(uuid, index * 4)?)? };
        nonzero |= word;
        for byte in word.to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    }
    (nonzero != 0 && hash != 0).then_some(hash)
}

pub(crate) unsafe fn tick(layout: Layout) {
    match unsafe { resolve_game(layout) } {
        GameState::Ready {
            game,
            map_id,
            instance_type,
            play_region,
            ..
        } if play_region == PLAY_REGION_PVE || play_region == PLAY_REGION_PVP => unsafe {
            let key = character_key(layout, game);
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
                };
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
