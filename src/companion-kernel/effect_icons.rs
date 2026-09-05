//! Bounded geometry for stock Effects icons. The transformed client publishes
//! only the certified Effects label hash; this module resolves visible child
//! frames that belong to that parent and match `skill_id + 4`.

use core::ptr::{read_volatile, write_volatile};

use crate::abi::*;
use crate::memory::*;
use crate::player_effects;

const MAX_FRAMES: u32 = 16_384;
const MAX_RELATION_DEPTH: u32 = 16;
const RELATION_HASH_ID: u32 = 0x0c;
const FULL_AUDIT_TICKS: u32 = 30;
const HEARTBEAT_TICKS: u32 = 6;
const CREATED: u32 = 0x4;
const HIDDEN: u32 = 0x200;
const EMPTY_RECT: SkillSlotRect = SkillSlotRect {
    left: 0.0, bottom: 0.0, right: 0.0, top: 0.0,
};
const EMPTY_ICON: EffectIconRecord = EffectIconRecord {
    skill_id: 0, rectangle: EMPTY_RECT,
};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut GENERATION: u32 = 0;
static mut LAST_AUDIT: u32 = 0;
static mut LAST_PUBLISH: u32 = 0;
static mut CACHED_PARENT_HASH: u32 = 0;
static mut CACHED_EFFECT_GENERATION: u32 = 0;

#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Inactive = 1,
    InvalidInput = 2,
    FrameTable = 3,
    ParentMissing = 4,
    ParentHidden = 5,
    ChildAmbiguous = 6,
    ChildInvalid = 7,
    RelationMismatch = 8,
    ParentAmbiguous = 9,
}

#[derive(Clone, Copy)]
struct Observation {
    flags: u32,
    frame_id: u32,
    viewport_width: f32,
    viewport_height: f32,
    count: u32,
    icons: [EffectIconRecord; EFFECT_RECORDS],
    outcome: u32,
    candidates: u32,
}

impl Observation {
    const fn inactive() -> Self {
        Self {
            flags: 0,
            frame_id: 0,
            viewport_width: 0.0,
            viewport_height: 0.0,
            count: 0,
            icons: [EMPTY_ICON; EFFECT_RECORDS],
            outcome: Outcome::Inactive as u32,
            candidates: 0,
        }
    }
}

unsafe fn same_current(right: Observation) -> bool {
    let snapshot = unsafe { POINTER as *const EffectIconSnapshot };
    if unsafe { read_volatile(&(*snapshot).flags) } != right.flags
        || unsafe { read_volatile(&(*snapshot).count) } != right.count
        || unsafe { read_volatile(&(*snapshot).frame_id) } != right.frame_id
        || unsafe { read_volatile(&(*snapshot).viewport_width) }.to_bits()
            != right.viewport_width.to_bits()
        || unsafe { read_volatile(&(*snapshot).viewport_height) }.to_bits()
            != right.viewport_height.to_bits()
        || unsafe { read_volatile(&(*snapshot).outcome) } != right.outcome
        || unsafe { read_volatile(&(*snapshot).candidate_count) } != right.candidates
    {
        return false;
    }
    for index in 0..right.count as usize {
        let left = unsafe {
            read_volatile(core::ptr::addr_of!((*snapshot).icons)
                .cast::<EffectIconRecord>().add(index))
        };
        let icon = unsafe { *right.icons.get_unchecked(index) };
        if left.skill_id != icon.skill_id
            || left.rectangle.left.to_bits() != icon.rectangle.left.to_bits()
            || left.rectangle.bottom.to_bits() != icon.rectangle.bottom.to_bits()
            || left.rectangle.right.to_bits() != icon.rectangle.right.to_bits()
            || left.rectangle.top.to_bits() != icon.rectangle.top.to_bits()
        {
            return false;
        }
    }
    true
}

fn normalize(
    observed: Result<
        (u32, f32, f32, u32, [EffectIconRecord; EFFECT_RECORDS]),
        (Outcome, u32),
    >,
) -> Observation {
    match observed {
        Ok((frame_id, viewport_width, viewport_height, count, icons)) => Observation {
            flags: FLAG_EFFECT_ICONS_READY,
            frame_id,
            viewport_width,
            viewport_height,
            count,
            icons,
            outcome: 0,
            candidates: 0,
        },
        Err((outcome, candidates)) => Observation {
            flags: 0,
            frame_id: 0,
            viewport_width: 0.0,
            viewport_height: 0.0,
            count: 0,
            icons: [EMPTY_ICON; EFFECT_RECORDS],
            outcome: outcome as u32,
            candidates,
        },
    }
}

fn finite(value: f32) -> bool {
    value.is_finite() && value.abs() <= 32_768.0
}

unsafe fn frame_at(layout: Layout, array: u32, count: u32, id: u32) -> Option<u32> {
    if id >= count { return None; }
    let frame = indexed(array, id, 4)
        .and_then(|at| unsafe { pointer(at, layout.frame_bytes) })?;
    (offset(frame, layout.frame_id).and_then(|at| unsafe { read_u32(at) }) == Some(id))
        .then_some(frame)
}

unsafe fn belongs_to(layout: Layout, frame: u32, parent_relation: u32) -> Option<bool> {
    let mut relation = offset(frame, layout.frame_relation)?;
    for _ in 0..MAX_RELATION_DEPTH {
        let parent = unsafe { read_u32(relation)? };
        if parent == parent_relation { return Some(true); }
        if parent == 0 { return Some(false); }
        if parent & 3 != 0
            || !contains(parent, RELATION_HASH_ID.saturating_add(4))
            || parent == relation
        {
            return None;
        }
        relation = parent;
    }
    None
}

unsafe fn visible(layout: Layout, frame: u32) -> bool {
    offset(frame, layout.frame_state)
        .and_then(|at| unsafe { read_u32(at) })
        .is_some_and(|state| state & CREATED != 0 && state & HIDDEN == 0)
}

unsafe fn rectangle(
    layout: Layout,
    frame: u32,
    viewport_width: f32,
    viewport_height: f32,
) -> Option<SkillSlotRect> {
    let read = |field| offset(frame, field).and_then(|at| unsafe { read_f32(at) });
    let width = read(layout.frame_viewport_width)?;
    let height = read(layout.frame_viewport_height)?;
    let rect = SkillSlotRect {
        left: read(layout.frame_screen_left)?,
        bottom: read(layout.frame_screen_bottom)?,
        right: read(layout.frame_screen_right)?,
        top: read(layout.frame_screen_top)?,
    };
    (finite(width) && finite(height) && width > 0.0 && height > 0.0
        && width.to_bits() == viewport_width.to_bits()
        && height.to_bits() == viewport_height.to_bits()
        && [rect.left, rect.bottom, rect.right, rect.top]
            .iter().all(|value| finite(*value))
        && rect.right > rect.left && rect.top > rect.bottom
        && rect.right > 0.0 && rect.top > 0.0
        && rect.left < width && rect.bottom < height)
        .then_some(rect)
}

unsafe fn collect(
    layout: Layout,
    parent_hash: u32,
) -> Result<(u32, f32, f32, u32, [EffectIconRecord; EFFECT_RECORDS]), (Outcome, u32)> {
    if parent_hash == 0
        || layout.frame_bytes == 0
        || layout.frame_child_offset_id.saturating_add(4) > layout.frame_bytes
        || layout.frame_relation.saturating_add(RELATION_HASH_ID).saturating_add(4)
            > layout.frame_bytes
    {
        return Err((Outcome::InvalidInput, 0));
    }
    let count = unsafe { read_u32(layout.frame_count) }
        .filter(|value| *value > 0 && *value <= MAX_FRAMES)
        .ok_or((Outcome::FrameTable, 0))?;
    let array = unsafe { pointer(layout.frame_array, count.saturating_mul(4)) }
        .ok_or((Outcome::FrameTable, 0))?;
    let mut parent = 0_u32;
    let mut parent_id = 0_u32;
    let mut parent_matches = 0_u32;
    for id in 1..count {
        let Some(frame) = (unsafe { frame_at(layout, array, count, id) }) else { continue };
        let hash = offset(frame, layout.frame_relation)
            .and_then(|relation| offset(relation, RELATION_HASH_ID))
            .and_then(|at| unsafe { read_u32(at) });
        if hash == Some(parent_hash) {
            parent = frame;
            parent_id = id;
            parent_matches = parent_matches.saturating_add(1);
        }
    }
    if parent_matches == 0 { return Err((Outcome::ParentMissing, 0)); }
    if parent_matches > 1 { return Err((Outcome::ParentAmbiguous, parent_matches)); }
    if !unsafe { visible(layout, parent) } { return Err((Outcome::ParentHidden, 0)); }
    let viewport_width = offset(parent, layout.frame_viewport_width)
        .and_then(|at| unsafe { read_f32(at) })
        .filter(|value| finite(*value) && *value > 0.0)
        .ok_or((Outcome::ChildInvalid, 0))?;
    let viewport_height = offset(parent, layout.frame_viewport_height)
        .and_then(|at| unsafe { read_f32(at) })
        .filter(|value| finite(*value) && *value > 0.0)
        .ok_or((Outcome::ChildInvalid, 0))?;
    let parent_relation = offset(parent, layout.frame_relation)
        .ok_or((Outcome::ParentMissing, 0))?;
    let (effect_count, skills) = unsafe { player_effects::current_skills() };
    let mut records = [EMPTY_ICON; EFFECT_RECORDS];
    let mut unique_skills = [0_u32; EFFECT_RECORDS];
    let mut match_ids = [0_u32; EFFECT_RECORDS];
    let mut candidate_counts = [0_u32; EFFECT_RECORDS];
    let mut unique_count = 0_usize;
    for source in 0..effect_count as usize {
        let skill_id = unsafe { *skills.get_unchecked(source) };
        let mut duplicate = false;
        for index in 0..unique_count {
            if unsafe { *unique_skills.get_unchecked(index) } == skill_id {
                duplicate = true;
                break;
            }
        }
        if duplicate { continue; }
        if skill_id.checked_add(4).is_none() {
            return Err((Outcome::ChildInvalid, 0));
        }
        unsafe { *unique_skills.get_unchecked_mut(unique_count) = skill_id; }
        unique_count += 1;
    }

    let mut identifier_matches = 0_u32;
    let mut relation_matches = 0_u32;
    for id in 1..count {
        let Some(frame) = (unsafe { frame_at(layout, array, count, id) }) else { continue };
        if !unsafe { visible(layout, frame) } { continue; }
        let Some(child_offset) = offset(frame, layout.frame_child_offset_id)
            .and_then(|at| unsafe { read_u32(at) }) else { continue };
        for index in 0..unique_count {
            if unsafe { *unique_skills.get_unchecked(index) }.checked_add(4)
                == Some(child_offset)
            {
                identifier_matches = identifier_matches.saturating_add(1);
                match unsafe { belongs_to(layout, frame, parent_relation) } {
                    Some(true) => {}
                    Some(false) => break,
                    None => return Err((Outcome::ChildInvalid, identifier_matches)),
                }
                relation_matches = relation_matches.saturating_add(1);
                let candidates = unsafe { candidate_counts.get_unchecked_mut(index) };
                *candidates = candidates.saturating_add(1);
                unsafe { *match_ids.get_unchecked_mut(index) = id; }
                break;
            }
        }
    }
    if identifier_matches > 0 && relation_matches == 0 {
        return Err((Outcome::RelationMismatch, identifier_matches));
    }

    let mut output_count = 0_u32;
    for index in 0..unique_count {
        let candidates = unsafe { *candidate_counts.get_unchecked(index) };
        if candidates > 1 { return Err((Outcome::ChildAmbiguous, candidates)); }
        // Stock-hidden effects are valid but intentionally receive no overlay.
        if candidates == 0 { continue; }
        let frame = unsafe {
            frame_at(layout, array, count, *match_ids.get_unchecked(index))
        }.ok_or((Outcome::ChildInvalid, 0))?;
        let rect = unsafe { rectangle(layout, frame, viewport_width, viewport_height) }
            .ok_or((Outcome::ChildInvalid, 0))?;
        unsafe {
            *records.get_unchecked_mut(output_count as usize) = EffectIconRecord {
                skill_id: *unique_skills.get_unchecked(index),
                rectangle: rect,
            };
        }
        output_count += 1;
    }
    Ok((parent_id, viewport_width, viewport_height, output_count, records))
}

unsafe fn publish(observed: Option<Observation>) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut EffectIconSnapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        if let Some(value) = observed {
            write_volatile(&mut (*snapshot).magic, EFFECT_ICON_MAGIC);
            write_volatile(&mut (*snapshot).abi_and_size, EFFECT_ICON_ABI_AND_SIZE);
            write_volatile(&mut (*snapshot).flags, value.flags);
            write_volatile(&mut (*snapshot).generation, GENERATION);
            write_volatile(&mut (*snapshot).frame_id, value.frame_id);
            write_volatile(&mut (*snapshot).count, value.count);
            write_volatile(&mut (*snapshot).outcome, value.outcome);
            write_volatile(&mut (*snapshot).candidate_count, value.candidates);
            write_volatile(&mut (*snapshot).viewport_width, value.viewport_width);
            write_volatile(&mut (*snapshot).viewport_height, value.viewport_height);
            write_volatile(&mut (*snapshot).icons, value.icons);
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
        LAST_AUDIT = 0;
        LAST_PUBLISH = 0;
        CACHED_PARENT_HASH = 0;
        CACHED_EFFECT_GENERATION = 0;
    }
    for index in 0..EFFECT_ICON_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish(Some(Observation::inactive())) };
}

pub(crate) unsafe fn tick(layout: Layout, parent_hash: u32, tick: u32) {
    let effect_generation = unsafe { player_effects::current_generation() };
    let audit = parent_hash != unsafe { CACHED_PARENT_HASH }
        || effect_generation != unsafe { CACHED_EFFECT_GENERATION }
        || tick.wrapping_sub(unsafe { LAST_AUDIT }) >= FULL_AUDIT_TICKS;
    if audit {
        let observed = normalize(unsafe { collect(layout, parent_hash) });
        if !unsafe { same_current(observed) } {
            unsafe { GENERATION = GENERATION.wrapping_add(1); }
        }
        unsafe {
            CACHED_PARENT_HASH = parent_hash;
            CACHED_EFFECT_GENERATION = effect_generation;
            LAST_AUDIT = tick;
            publish(Some(observed));
            LAST_PUBLISH = tick;
        }
    } else if tick.wrapping_sub(unsafe { LAST_PUBLISH }) >= HEARTBEAT_TICKS {
        unsafe { publish(None); LAST_PUBLISH = tick; }
    }
}

pub(crate) unsafe fn inactive(tick: u32) {
    let inactive = Observation::inactive();
    let changed = !unsafe { same_current(inactive) };
    if changed || tick.wrapping_sub(unsafe { LAST_PUBLISH }) >= HEARTBEAT_TICKS {
        unsafe {
            if changed { GENERATION = GENERATION.wrapping_add(1); }
            publish(Some(inactive));
            LAST_PUBLISH = tick;
            CACHED_PARENT_HASH = 0;
        }
    }
}
