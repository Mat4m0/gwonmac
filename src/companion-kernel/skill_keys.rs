//! The read-only SkillBar frame observer and sole writer of its bounded region.
//!
//! The transformed game passes one frame ID on the normal tick callback. This
//! module resolves that ID through the certified frame table, finds exactly one
//! child for each offset 0..7, and publishes only screen bounds. No game pointer
//! crosses the snapshot ABI, and one malformed or missing child clears the
//! complete observation instead of leaving a partly aligned overlay visible.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::memory::*;

const MAX_FRAMES: u32 = 16_384;
// Slot frames are stable for long stretches. Revalidate the eight cached
// frames every tick, but only audit the complete table twice a second. A frame
// count or parent change forces an immediate audit.
const CACHE_AUDIT_TICKS: u32 = 30;
const CREATED: u32 = 0x4;
const HIDDEN: u32 = 0x200;

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut CACHE_PARENT_ID: u32 = 0;
static mut CACHE_FRAME_COUNT: u32 = 0;
static mut CACHE_AGE: u32 = CACHE_AUDIT_TICKS;
static mut CACHE_SLOT_IDS: [u32; 8] = [0; 8];

const EMPTY_RECT: SkillKeyRect = SkillKeyRect {
    left: 0.0,
    bottom: 0.0,
    right: 0.0,
    top: 0.0,
};

fn finite(value: f32) -> bool {
    value.is_finite() && value.abs() <= 32_768.0
}

fn valid_layout(layout: Layout) -> bool {
    layout.frame_array != 0
        && layout.frame_count != 0
        && layout.frame_bytes >= layout.frame_state.saturating_add(4)
        && layout.frame_bytes <= 2_048
        && [
            layout.frame_child_offset_id,
            layout.frame_id,
            layout.frame_position_flags,
            layout.frame_viewport_width,
            layout.frame_viewport_height,
            layout.frame_screen_left,
            layout.frame_screen_bottom,
            layout.frame_screen_right,
            layout.frame_screen_top,
            layout.frame_relation,
            layout.frame_state,
        ]
        .iter()
        .all(|offset| offset & 3 == 0 && offset.saturating_add(4) <= layout.frame_bytes)
}

unsafe fn frame_table(layout: Layout) -> Option<(u32, u32)> {
    let count = unsafe { read_u32(layout.frame_count)? };
    if count == 0 || count > MAX_FRAMES {
        return None;
    }
    let bytes = checked_mul(count, 4)?;
    let array = unsafe { pointer(layout.frame_array, bytes)? };
    Some((array, count))
}

unsafe fn frame_at(layout: Layout, array: u32, count: u32, id: u32) -> Option<u32> {
    if id >= count {
        return None;
    }
    let entry = indexed(array, id, 4)?;
    let frame = unsafe { pointer(entry, layout.frame_bytes)? };
    let stored_id = offset(frame, layout.frame_id).and_then(|at| unsafe { read_u32(at) })?;
    (stored_id == id).then_some(frame)
}

unsafe fn visible(layout: Layout, frame: u32) -> bool {
    offset(frame, layout.frame_state)
        .and_then(|at| unsafe { read_u32(at) })
        .is_some_and(|state| state & CREATED != 0 && state & HIDDEN == 0)
}

unsafe fn rect(layout: Layout, frame: u32) -> Option<(SkillKeyRect, f32, f32)> {
    let read = |field| offset(frame, field).and_then(|at| unsafe { read_f32(at) });
    let viewport_width = read(layout.frame_viewport_width)?;
    let viewport_height = read(layout.frame_viewport_height)?;
    let next = SkillKeyRect {
        left: read(layout.frame_screen_left)?,
        bottom: read(layout.frame_screen_bottom)?,
        right: read(layout.frame_screen_right)?,
        top: read(layout.frame_screen_top)?,
    };
    if ![
        viewport_width,
        viewport_height,
        next.left,
        next.bottom,
        next.right,
        next.top,
    ]
    .iter()
    .all(|value| finite(*value))
        || viewport_width <= 0.0
        || viewport_height <= 0.0
        || next.left < 0.0
        || next.bottom < 0.0
        || next.right <= next.left
        || next.top <= next.bottom
        || next.right > viewport_width
        || next.top > viewport_height
    {
        return None;
    }
    Some((next, viewport_width, viewport_height))
}

type Observation = (f32, f32, [SkillKeyRect; 8]);

unsafe fn collect_cached(
    layout: Layout,
    array: u32,
    count: u32,
    skill_bar_id: u32,
    slot_ids: [u32; 8],
) -> Option<Observation> {
    let parent = unsafe { frame_at(layout, array, count, skill_bar_id)? };
    if !unsafe { visible(layout, parent) } {
        return None;
    }
    let parent_relation = offset(parent, layout.frame_relation)?;
    let mut slots = [EMPTY_RECT; 8];
    let mut viewport_width = 0.0;
    let mut viewport_height = 0.0;
    for (child, id) in slot_ids.iter().copied().enumerate() {
        let frame = unsafe { frame_at(layout, array, count, id)? };
        let relation = offset(frame, layout.frame_relation)
            .and_then(|at| unsafe { read_u32(at) });
        let stored_child = offset(frame, layout.frame_child_offset_id)
            .and_then(|at| unsafe { read_u32(at) });
        if relation != Some(parent_relation)
            || stored_child != Some(child as u32)
            || !unsafe { visible(layout, frame) }
        {
            return None;
        }
        let (bounds, width, height) = unsafe { rect(layout, frame)? };
        if child != 0 && (width != viewport_width || height != viewport_height) {
            return None;
        }
        viewport_width = width;
        viewport_height = height;
        slots[child] = bounds;
    }
    Some((viewport_width, viewport_height, slots))
}

unsafe fn discover(
    layout: Layout,
    array: u32,
    count: u32,
    skill_bar_id: u32,
) -> Option<(Observation, [u32; 8])> {
    let parent = unsafe { frame_at(layout, array, count, skill_bar_id)? };
    if !unsafe { visible(layout, parent) } {
        return None;
    }
    let parent_relation = offset(parent, layout.frame_relation)?;
    let mut slot_ids = [0_u32; 8];
    let mut found = 0_u32;
    for id in 1..count {
        let Some(frame) = (unsafe { frame_at(layout, array, count, id) }) else {
            continue;
        };
        let relation = offset(frame, layout.frame_relation)
            .and_then(|at| unsafe { read_u32(at) });
        if relation != Some(parent_relation) {
            continue;
        }
        let Some(child) = offset(frame, layout.frame_child_offset_id)
            .and_then(|at| unsafe { read_u32(at) })
        else {
            continue;
        };
        if child >= 8 || !unsafe { visible(layout, frame) } {
            continue;
        }
        // Two visible frames claiming one skill slot are ambiguous. Never let
        // table order decide which plausible-looking rectangle reaches the HUD.
        if found & (1 << child) != 0 {
            return None;
        }
        slot_ids[child as usize] = id;
        found |= 1 << child;
    }
    if found != 0xff {
        return None;
    }
    let observed = unsafe {
        collect_cached(layout, array, count, skill_bar_id, slot_ids)?
    };
    Some((observed, slot_ids))
}

unsafe fn collect(layout: Layout, skill_bar_id: u32) -> Option<Observation> {
    if skill_bar_id == 0 || !valid_layout(layout) {
        return None;
    }
    let (array, count) = unsafe { frame_table(layout)? };
    let cache_matches = unsafe {
        CACHE_PARENT_ID == skill_bar_id
            && CACHE_FRAME_COUNT == count
            && CACHE_AGE < CACHE_AUDIT_TICKS
    };
    if cache_matches {
        let slot_ids = unsafe { CACHE_SLOT_IDS };
        if let Some(observed) = unsafe {
            collect_cached(layout, array, count, skill_bar_id, slot_ids)
        } {
            unsafe { CACHE_AGE = CACHE_AGE.saturating_add(1) };
            return Some(observed);
        }
    }
    let (observed, slot_ids) = unsafe { discover(layout, array, count, skill_bar_id)? };
    unsafe {
        CACHE_PARENT_ID = skill_bar_id;
        CACHE_FRAME_COUNT = count;
        CACHE_AGE = 0;
        CACHE_SLOT_IDS = slot_ids;
    }
    Some(observed)
}

unsafe fn publish(frame_id: u32, observed: Option<(f32, f32, [SkillKeyRect; 8])>) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut SkillKeySnapshot };
    let (flags, viewport_width, viewport_height, slots) = observed
        .map(|(width, height, slots)| (FLAG_SKILL_KEYS_READY, width, height, slots))
        .unwrap_or((0, 0.0, 0.0, [EMPTY_RECT; 8]));
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, SKILL_KEY_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, SKILL_KEY_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, flags);
        write_volatile(&mut (*snapshot).frame_id, if flags == 0 { 0 } else { frame_id });
        write_volatile(&mut (*snapshot).viewport_width, viewport_width);
        write_volatile(&mut (*snapshot).viewport_height, viewport_height);
        write_volatile(&mut (*snapshot).slots, slots);
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
        CACHE_PARENT_ID = 0;
        CACHE_FRAME_COUNT = 0;
        CACHE_AGE = CACHE_AUDIT_TICKS;
        CACHE_SLOT_IDS = [0; 8];
    }
    for index in 0..SKILL_KEY_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish(0, None) };
}

pub(crate) unsafe fn tick(layout: Layout, skill_bar_id: u32) {
    let observed = unsafe { collect(layout, skill_bar_id) };
    unsafe { publish(skill_bar_id, observed) };
}
