//! Bounded publication of the current PvE/PvP policy fact.
//!
//! This observer deliberately stops at the character context and one indexed
//! area-table record. It never opens the agent array, so Travel-only recovery
//! cannot inherit the full snapshot's player scan.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::{resolve_game, GameState};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;

unsafe fn publish(flags: u32, map_id: u32, instance_type: u32, play_region: u32) {
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
    unsafe { publish(0, 0, 0, 0) };
}

pub(crate) unsafe fn tick(layout: Layout) {
    match unsafe { resolve_game(layout) } {
        GameState::Ready {
            map_id,
            instance_type,
            play_region,
            ..
        } if play_region == PLAY_REGION_PVE || play_region == PLAY_REGION_PVP => unsafe {
            publish(FLAG_PLAY_REGION_READY, map_id, instance_type, play_region);
        },
        GameState::Loading => unsafe {
            publish(FLAG_PLAY_REGION_LOADING, 0, 0, 0);
        },
        GameState::Ready { .. } | GameState::Unavailable => unsafe {
            publish(0, 0, 0, 0);
        },
    }
}
