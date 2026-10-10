//! Bounded publication of the current character's mission, vanquish and
//! Cartographer progress, plus a one-time copy of the static AreaInfo rows.
//!
//! The Hub derives every list and count from these words; the kernel copies
//! certified fields and decides nothing about titles or catalogues. Progress
//! is published only in PvE with a known character, so a loading screen or a
//! PvP map can never look like an empty record.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::memory::{checked_add, checked_mul, contains, indexed, offset, pointer, read_u32};
use crate::play_region::current_character_key;
use crate::{resolve_game, GameState};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut AREAS_COPIED: bool = false;

type Words = [u32; TRAVEL_UNLOCK_WORDS];

struct Progress {
    flags: u32,
    map_id: u32,
    character_key: u64,
    missions: [Words; PROGRESS_MISSION_SETS],
    vanquished: Words,
    titles: [[u32; 2]; 3],
}

const EMPTY: Progress = Progress {
    flags: 0,
    map_id: 0,
    character_key: 0,
    missions: [[0; TRAVEL_UNLOCK_WORDS]; PROGRESS_MISSION_SETS],
    vanquished: [0; TRAVEL_UNLOCK_WORDS],
    titles: [[0; 2]; 3],
};

unsafe fn snapshot() -> *mut ProgressSnapshot {
    unsafe { POINTER as *mut ProgressSnapshot }
}

/// Copies the static AreaInfo table once. The rows are game constants, so a
/// later tick never needs to read them again.
unsafe fn copy_areas(layout: Layout) -> u32 {
    let fields = [
        layout.area_info_flags,
        layout.area_info_thumbnail,
        layout.area_info_name,
        layout.area_info_x,
        layout.area_info_y,
    ];
    if layout.area_info == 0
        || layout.area_info_count == 0
        || layout.area_info_stride < 20
        || fields.iter().any(|field| *field == 0 || field.saturating_add(4) > layout.area_info_stride)
        || layout.area_info_icon == 0
        || layout.area_info_icon.saturating_add(32) > layout.area_info_stride
    {
        return 0;
    }
    let count = core::cmp::min(layout.area_info_count as usize, PROGRESS_AREA_ROWS) as u32;
    let Some(bytes) = checked_mul(count, layout.area_info_stride) else {
        return 0;
    };
    if !contains(layout.area_info, bytes) {
        return 0;
    }
    let target = unsafe { snapshot() };
    for row in 0..count {
        let Some(record) = indexed(layout.area_info, row, layout.area_info_stride) else {
            return 0;
        };
        let read = |field: u32| offset(record, field).and_then(|at| unsafe { read_u32(at) });
        let words = (|| {
            let mut packed = 1 << 31;
            for (index, field) in [0_u32, 4, 8, 12].iter().enumerate() {
                let value = read(*field)?;
                if value > 0xff {
                    return None;
                }
                packed |= value << (index * 8);
            }
            if read(layout.area_info_thumbnail)? != 0 {
                packed |= 1 << 30;
            }
            let (x, y) = (read(layout.area_info_x)?, read(layout.area_info_y)?);
            // A town or mission has a map point; an explorable area has only
            // its icon rectangle, so its centre stands in for the point.
            let (x, y) = if x != 0 || y != 0 {
                (x, y)
            } else {
                let mut centre = (0, 0);
                for rect in [layout.area_info_icon, layout.area_info_icon + 16] {
                    let [left, top, right, bottom] =
                        [read(rect)?, read(rect + 4)?, read(rect + 8)?, read(rect + 12)?];
                    if right > left && bottom > top {
                        centre = (left + (right - left) / 2, top + (bottom - top) / 2);
                        break;
                    }
                }
                centre
            };
            Some([packed, read(layout.area_info_flags)?, read(layout.area_info_name)?, x, y])
        })()
        .unwrap_or([0; PROGRESS_AREA_WORDS]);
        unsafe { write_volatile(&mut (*target).areas[row as usize], words) };
    }
    count
}

/// Reads one certified WorldContext `Array<u32>` bitset. Missing words mean
/// "not done"; a malformed array is unknown.
unsafe fn read_bits(world: u32, field: u32) -> Option<Words> {
    if field == 0 {
        return None;
    }
    let array = offset(world, field)?;
    let buffer = unsafe { read_u32(array) }?;
    let capacity = offset(array, 4).and_then(|at| unsafe { read_u32(at) })?;
    let size = offset(array, 8).and_then(|at| unsafe { read_u32(at) })?;
    if size != 0 && (buffer == 0 || buffer & 3 != 0)
        || size > capacity
        || capacity > 64
        || size != 0 && !contains(buffer, checked_mul(size, 4)?)
    {
        return None;
    }
    let mut words = [0; TRAVEL_UNLOCK_WORDS];
    for (index, word) in words
        .iter_mut()
        .take(core::cmp::min(size as usize, TRAVEL_UNLOCK_WORDS))
        .enumerate()
    {
        *word = unsafe { read_u32(indexed(buffer, index as u32, 4)?)? };
    }
    Some(words)
}

/// Reads `props, points` for each Cartographer title from the title array.
unsafe fn read_titles(layout: Layout, world: u32) -> Option<[[u32; 2]; 3]> {
    if layout.world_titles == 0
        || layout.title_stride < 8
        || layout.title_props.saturating_add(4) > layout.title_stride
        || layout.title_points == 0
        || layout.title_points.saturating_add(4) > layout.title_stride
    {
        return None;
    }
    let array = offset(world, layout.world_titles)?;
    let buffer = unsafe { read_u32(array) }?;
    let size = offset(array, 8).and_then(|at| unsafe { read_u32(at) })?;
    if buffer == 0 || buffer & 3 != 0 || size > 64 || !contains(buffer, checked_mul(size, layout.title_stride)?) {
        return None;
    }
    let mut titles = [[0; 2]; 3];
    for (slot, id) in titles.iter_mut().zip(PROGRESS_TITLE_IDS) {
        if id >= size {
            return None;
        }
        let record = indexed(buffer, id, layout.title_stride)?;
        *slot = [
            unsafe { read_u32(offset(record, layout.title_props)?)? },
            unsafe { read_u32(offset(record, layout.title_points)?)? },
        ];
    }
    Some(titles)
}

unsafe fn observe(layout: Layout, game: u32, map_id: u32) -> Progress {
    let Some(key) = (unsafe { current_character_key(layout, game) }) else {
        return EMPTY;
    };
    let mut progress = Progress { flags: FLAG_PROGRESS_READY, map_id, character_key: key, ..EMPTY };
    let fields = [
        layout.world_missions_completed,
        layout.world_missions_bonus,
        layout.world_missions_completed_hm,
        layout.world_missions_bonus_hm,
        layout.world_vanquished_areas,
        layout.world_titles,
    ];
    if layout.world_context == 0 {
        return progress;
    }
    let Some(required) = fields.iter().max().and_then(|field| checked_add(*field, 12)) else {
        return progress;
    };
    let Some(world) = offset(game, layout.world_context).and_then(|at| unsafe { pointer(at, required) })
    else {
        return progress;
    };
    let mut missions = [[0; TRAVEL_UNLOCK_WORDS]; PROGRESS_MISSION_SETS];
    let mut complete = true;
    for (set, field) in missions.iter_mut().zip(fields) {
        match unsafe { read_bits(world, field) } {
            Some(words) => *set = words,
            None => complete = false,
        }
    }
    if complete {
        progress.missions = missions;
        progress.flags |= FLAG_PROGRESS_MISSIONS;
    }
    if let Some(words) = unsafe { read_bits(world, layout.world_vanquished_areas) } {
        progress.vanquished = words;
        progress.flags |= FLAG_PROGRESS_VANQUISHES;
    }
    if let Some(titles) = unsafe { read_titles(layout, world) } {
        progress.titles = titles;
        progress.flags |= FLAG_PROGRESS_TITLES;
    }
    progress
}

unsafe fn publish(progress: Progress, area_count: u32) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let target = unsafe { snapshot() };
    let flags = progress.flags | if area_count != 0 { FLAG_PROGRESS_AREAS } else { 0 };
    unsafe {
        write_volatile(&mut (*target).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*target).magic, PROGRESS_MAGIC);
        write_volatile(&mut (*target).abi_and_size, PROGRESS_ABI_AND_SIZE);
        write_volatile(&mut (*target).flags, flags);
        write_volatile(&mut (*target).map_id, progress.map_id);
        write_volatile(&mut (*target).character_key_low, progress.character_key as u32);
        write_volatile(&mut (*target).character_key_high, (progress.character_key >> 32) as u32);
        write_volatile(&mut (*target).area_count, area_count);
        write_volatile(&mut (*target).missions, progress.missions);
        write_volatile(&mut (*target).vanquished, progress.vanquished);
        write_volatile(&mut (*target).titles, progress.titles);
        write_volatile(&mut (*target).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
        AREAS_COPIED = false;
    }
    for index in 0..PROGRESS_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish(EMPTY, 0) };
}

pub(crate) unsafe fn tick(layout: Layout) {
    let state = unsafe { resolve_game(layout) };
    let mut area_count = unsafe { read_area_count() };
    if !unsafe { AREAS_COPIED } && matches!(state, GameState::Ready { .. }) {
        // The copy happens outside a sequence window on purpose: readers see
        // the rows only through `area_count`, which the next publish sets.
        area_count = unsafe { copy_areas(layout) };
        unsafe { AREAS_COPIED = true };
    }
    let progress = match state {
        GameState::Ready { game, map_id, play_region: PLAY_REGION_PVE, .. } => unsafe {
            observe(layout, game, map_id)
        },
        GameState::Loading => Progress { flags: FLAG_PROGRESS_LOADING, ..EMPTY },
        GameState::Ready { .. } | GameState::Unavailable => EMPTY,
    };
    unsafe { publish(progress, area_count) };
}

unsafe fn read_area_count() -> u32 {
    unsafe { core::ptr::read_volatile(&(*snapshot()).area_count) }
}
