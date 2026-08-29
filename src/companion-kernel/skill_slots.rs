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
const FLAG_CHAT_INPUT_READY: u32 = 1 << 1;
#[derive(Clone, Copy)]
#[repr(u32)]
enum Outcome {
    Inactive = 1,
    InvalidInput = 2,
    FrameTable = 3,
    ParentMissing = 4,
    ParentHidden = 5,
    SlotMissing = 6,
    SlotAmbiguous = 7,
    SlotRelation = 8,
    SlotHidden = 9,
    ViewportInvalid = 10,
    SlotNonfinite = 11,
    SlotOrder = 12,
    SlotOutsideViewport = 13,
    ViewportMismatch = 14,
}

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut CACHE_PARENT_ID: u32 = 0;
static mut CACHE_FRAME_COUNT: u32 = 0;
static mut CACHE_AGE: u32 = CACHE_AUDIT_TICKS;
static mut CACHE_SLOT_IDS: [u32; 8] = [0; 8];

const EMPTY_RECT: SkillSlotRect = SkillSlotRect {
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

unsafe fn rect(layout: Layout, frame: u32) -> Result<(SkillSlotRect, f32, f32), Outcome> {
    let read = |field| offset(frame, field).and_then(|at| unsafe { read_f32(at) });
    let viewport_width = read(layout.frame_viewport_width).ok_or(Outcome::ViewportInvalid)?;
    let viewport_height = read(layout.frame_viewport_height).ok_or(Outcome::ViewportInvalid)?;
    let next = SkillSlotRect {
        left: read(layout.frame_screen_left).ok_or(Outcome::SlotNonfinite)?,
        bottom: read(layout.frame_screen_bottom).ok_or(Outcome::SlotNonfinite)?,
        right: read(layout.frame_screen_right).ok_or(Outcome::SlotNonfinite)?,
        top: read(layout.frame_screen_top).ok_or(Outcome::SlotNonfinite)?,
    };
    if !finite(viewport_width) || !finite(viewport_height)
        || viewport_width <= 0.0 || viewport_height <= 0.0 {
        return Err(Outcome::ViewportInvalid);
    }
    if ![next.left, next.bottom, next.right, next.top].iter().all(|value| finite(*value)) {
        return Err(Outcome::SlotNonfinite);
    }
    if next.right <= next.left || next.top <= next.bottom {
        return Err(Outcome::SlotOrder);
    }
    // Guild Wars uses bottom-left coordinates and permits frames to be clipped
    // by a viewport edge. The established FramePosition projection therefore
    // accepts signed screen_* values. Refuse only a rectangle with no visible
    // intersection; requiring every edge to be in bounds rejected the real
    // bottom-anchored SkillBar before either overlay could render.
    if next.right <= 0.0
        || next.top <= 0.0
        || next.left >= viewport_width
        || next.bottom >= viewport_height
    {
        return Err(Outcome::SlotOutsideViewport);
    }
    Ok((next, viewport_width, viewport_height))
}

type Observation = (f32, f32, [SkillSlotRect; 8]);

#[derive(Clone, Copy)]
struct Refusal {
    outcome: Outcome,
    candidate_count: u32,
}

fn refuse(outcome: Outcome) -> Refusal {
    Refusal { outcome, candidate_count: 0 }
}

fn refuse_ambiguity(candidate_count: u32) -> Refusal {
    Refusal { outcome: Outcome::SlotAmbiguous, candidate_count }
}

unsafe fn collect_cached(
    layout: Layout,
    array: u32,
    count: u32,
    skill_bar_id: u32,
    slot_ids: [u32; 8],
) -> Result<Observation, Refusal> {
    let parent = unsafe { frame_at(layout, array, count, skill_bar_id) }
        .ok_or_else(|| refuse(Outcome::ParentMissing))?;
    if !unsafe { visible(layout, parent) } {
        return Err(refuse(Outcome::ParentHidden));
    }
    let parent_relation = offset(parent, layout.frame_relation)
        .ok_or_else(|| refuse(Outcome::SlotRelation))?;
    let mut slots = [EMPTY_RECT; 8];
    let mut viewport_width = 0.0;
    let mut viewport_height = 0.0;
    for (child, id) in slot_ids.iter().copied().enumerate() {
        let frame = unsafe { frame_at(layout, array, count, id) }
            .ok_or_else(|| refuse(Outcome::SlotMissing))?;
        let relation = offset(frame, layout.frame_relation)
            .and_then(|at| unsafe { read_u32(at) });
        let stored_child = offset(frame, layout.frame_child_offset_id)
            .and_then(|at| unsafe { read_u32(at) });
        if relation != Some(parent_relation) || stored_child != Some(child as u32) {
            return Err(refuse(Outcome::SlotRelation));
        }
        if !unsafe { visible(layout, frame) } {
            return Err(refuse(Outcome::SlotHidden));
        }
        let (bounds, width, height) = unsafe { rect(layout, frame) }
            .map_err(refuse)?;
        if child != 0 && (width != viewport_width || height != viewport_height) {
            return Err(refuse(Outcome::ViewportMismatch));
        }
        viewport_width = width;
        viewport_height = height;
        slots[child] = bounds;
    }
    Ok((viewport_width, viewport_height, slots))
}

unsafe fn discover(
    layout: Layout,
    array: u32,
    count: u32,
    skill_bar_id: u32,
) -> Result<(Observation, [u32; 8]), Refusal> {
    let parent = unsafe { frame_at(layout, array, count, skill_bar_id) }
        .ok_or_else(|| refuse(Outcome::ParentMissing))?;
    if !unsafe { visible(layout, parent) } {
        return Err(refuse(Outcome::ParentHidden));
    }
    let parent_relation = offset(parent, layout.frame_relation)
        .ok_or_else(|| refuse(Outcome::SlotRelation))?;
    let mut slot_ids = [0_u32; 8];
    let mut found = 0_u32;
    let mut candidate_counts = [0_u32; 8];
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
        candidate_counts[child as usize] = candidate_counts[child as usize].saturating_add(1);
        if found & (1 << child) == 0 {
            slot_ids[child as usize] = id;
            found |= 1 << child;
        }
    }
    // Never let table order choose between two visible frames that claim the
    // same slot. Finish the bounded scan so the diagnostic count has one exact
    // meaning: the largest number of candidates for a single slot.
    let candidate_count = candidate_counts.iter().copied().max().unwrap_or(0);
    if candidate_count > 1 {
        return Err(refuse_ambiguity(candidate_count));
    }
    if found != 0xff {
        return Err(refuse(Outcome::SlotMissing));
    }
    let observed = unsafe { collect_cached(layout, array, count, skill_bar_id, slot_ids)? };
    Ok((observed, slot_ids))
}

unsafe fn collect(layout: Layout, skill_bar_id: u32) -> Result<Observation, Refusal> {
    if skill_bar_id == 0 || !valid_layout(layout) {
        return Err(refuse(Outcome::InvalidInput));
    }
    let (array, count) = unsafe { frame_table(layout) }
        .ok_or_else(|| refuse(Outcome::FrameTable))?;
    let cache_matches = unsafe {
        CACHE_PARENT_ID == skill_bar_id
            && CACHE_FRAME_COUNT == count
            && CACHE_AGE < CACHE_AUDIT_TICKS
    };
    if cache_matches {
        let slot_ids = unsafe { CACHE_SLOT_IDS };
        if let Ok(observed) = unsafe {
            collect_cached(layout, array, count, skill_bar_id, slot_ids)
        } {
            unsafe { CACHE_AGE = CACHE_AGE.saturating_add(1) };
            return Ok(observed);
        }
    }
    let (observed, slot_ids) = unsafe { discover(layout, array, count, skill_bar_id)? };
    unsafe {
        CACHE_PARENT_ID = skill_bar_id;
        CACHE_FRAME_COUNT = count;
        CACHE_AGE = 0;
        CACHE_SLOT_IDS = slot_ids;
    }
    Ok(observed)
}

unsafe fn collect_chat(
    layout: Layout,
    chat_frame_id: u32,
) -> Result<SkillSlotRect, Refusal> {
    if chat_frame_id == 0 || !valid_layout(layout) {
        return Err(refuse(Outcome::InvalidInput));
    }
    let (array, count) = unsafe { frame_table(layout) }
        .ok_or_else(|| refuse(Outcome::FrameTable))?;
    let frame = unsafe { frame_at(layout, array, count, chat_frame_id) }
        .ok_or_else(|| refuse(Outcome::ParentMissing))?;
    if !unsafe { visible(layout, frame) } {
        return Err(refuse(Outcome::ParentHidden));
    }
    let (bounds, _, _) = unsafe { rect(layout, frame) }.map_err(refuse)?;
    Ok(bounds)
}

unsafe fn publish(
    frame_id: u32,
    observed: Result<Observation, Refusal>,
    chat_frame_id: u32,
    chat_observed: Result<SkillSlotRect, Refusal>,
) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut SkillSlotSnapshot };
    let (mut flags, outcome, candidate_count, viewport_width, viewport_height, slots) = match observed {
        Ok((width, height, slots)) => (FLAG_SKILL_SLOTS_READY, 0, 0, width, height, slots),
        Err(refusal) => (
            0,
            refusal.outcome as u32,
            refusal.candidate_count,
            0.0,
            0.0,
            [EMPTY_RECT; 8],
        ),
    };
    // Chat frames can carry a local clipping viewport while their screen
    // bounds remain in the global interface coordinate space. The certified
    // skill viewport is the projection source; requiring the local sizes to
    // match discarded the real movable chat editor.
    let (published_chat_id, chat_outcome, chat_input) = match chat_observed {
        Ok(bounds) if flags & FLAG_SKILL_SLOTS_READY != 0 => {
            flags |= FLAG_CHAT_INPUT_READY;
            (chat_frame_id, 0, bounds)
        }
        Ok(_) => (0, Outcome::ViewportMismatch as u32, EMPTY_RECT),
        Err(refusal) => (0, refusal.outcome as u32, EMPTY_RECT),
    };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, SKILL_SLOT_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, SKILL_SLOT_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, flags);
        write_volatile(
            &mut (*snapshot).frame_id,
            if flags & FLAG_SKILL_SLOTS_READY == 0 { 0 } else { frame_id },
        );
        write_volatile(&mut (*snapshot).outcome, outcome);
        write_volatile(&mut (*snapshot).candidate_count, candidate_count);
        write_volatile(&mut (*snapshot).viewport_width, viewport_width);
        write_volatile(&mut (*snapshot).viewport_height, viewport_height);
        write_volatile(&mut (*snapshot).slots, slots);
        write_volatile(&mut (*snapshot).chat_frame_id, published_chat_id);
        write_volatile(&mut (*snapshot).chat_outcome, chat_outcome);
        write_volatile(&mut (*snapshot).chat_input, chat_input);
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
    for index in 0..SKILL_SLOT_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe {
        publish(
            0,
            Err(refuse(Outcome::Inactive)),
            0,
            Err(refuse(Outcome::Inactive)),
        )
    };
}

pub(crate) unsafe fn tick(layout: Layout, skill_bar_id: u32, chat_frame_id: u32) {
    let observed = unsafe { collect(layout, skill_bar_id) };
    let chat_observed = unsafe { collect_chat(layout, chat_frame_id) };
    unsafe { publish(skill_bar_id, observed, chat_frame_id, chat_observed) };
}
