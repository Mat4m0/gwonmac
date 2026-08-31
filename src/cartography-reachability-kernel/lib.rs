//! Bounded current-instance reachability for Cartography.
//!
//! The host supplies only a player id, map id, certified world anchor, and one
//! host-owned output/scratch region. This module follows the exact Guild Wars
//! pathing structures internally and publishes only a fixed cell bitset. No
//! native pointer or graph record crosses back into JavaScript.
//!
//! The bounded graph flood, paired-portal traversal, blocked-plane rule, and
//! travel-doorway test are ported from GWToolbox++ Pathing.cpp and
//! CartographerWidget.cpp at baaaf0de574b02008baa57a574625a99009cd5ac
//! under its MIT License. See THIRD-PARTY-NOTICES.md and COPYING-GWTOOLBOX.

#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

use core::panic::PanicInfo;
use core::ptr::{read_volatile, write_volatile};

const ABI: u32 = 3;
const MAGIC: u32 = 0x5257_4347; // GCWR
const STATUS_READY: u32 = 1;
const STATUS_INVALID_INPUT: u32 = 2;
const STATUS_UNAVAILABLE: u32 = 3;
const STATUS_LIMIT: u32 = 4;
const STATUS_NO_START: u32 = 5;
const STATUS_AMBIGUOUS_LAYOUT: u32 = 6;
const STATUS_PLANE_LIMIT: u32 = 7;
const STATUS_TRAPEZOID_LIMIT: u32 = 8;
const STATUS_DOORWAY_LIMIT: u32 = 9;
const STATUS_VISUAL_RASTER_LIMIT: u32 = 10;

const MAX_PLANES: usize = 256;
const MAX_TRAPS: u32 = 65_536;
// Guild Wars publishes a 256x512 exploration bitmap on Tyria.
const MAX_CELLS: u32 = 131_072;
const CELL_WORDS: u32 = MAX_CELLS / 32;
const MAX_DOORWAYS: u32 = 256;
const MAX_VISUAL_RASTER_CELLS: u32 = 262_144;
const MIN_VISUAL_MAP_UNITS_PER_PIXEL: f32 = 2.0;

const HEADER_BYTES: u32 = 72;
const CELL_BITS: u32 = HEADER_BYTES;
const VISITED_BITS: u32 = CELL_BITS + CELL_WORDS * 4;
const VISITED_WORDS: u32 = MAX_TRAPS / 32;
const QUEUE_POINTERS: u32 = VISITED_BITS + VISITED_WORDS * 4;
const QUEUE_PLANES: u32 = QUEUE_POINTERS + MAX_TRAPS * 4;
const DOORWAYS: u32 = QUEUE_PLANES + MAX_TRAPS * 4;
const DOORWAY_BYTES: u32 = 12;
const VISUAL_BITS: u32 = DOORWAYS + MAX_DOORWAYS * DOORWAY_BYTES;
const VISUAL_WORDS: u32 = MAX_VISUAL_RASTER_CELLS / 32;
// Before the terrain raster overwrites this scratch, its two equal halves hold
// reachable ground and all navmesh ground at continent-cell resolution.
const REACHABLE_CELL_BITS: u32 = VISUAL_BITS;
const NAVMESH_CELL_BITS: u32 = REACHABLE_CELL_BITS + CELL_WORDS * 4;
const REGION_BYTES: u32 = VISUAL_BITS + VISUAL_WORDS * 4;

const GAME_CONTEXT_SLOT: u32 = 6;
const MAP_CONTEXT: u32 = 0x14;
const PATH_CONTEXT: u32 = 0x74;
const PROPS_CONTEXT: u32 = 0x7c;
const STATIC_DATA: u32 = 0x00;
const BLOCKED_PLANES: u32 = 0x04;
const STATIC_MAP_ARRAY: u32 = 0x18;
const MAP_CONTEXT_MAP_ID: u32 = 0x8c;
const PATHING_MAP_BYTES: u32 = 0x54;
const TRAP_BYTES: u32 = 0x30;
const PORTAL_BYTES: u32 = 0x14;
const ROOT_NODE: u32 = 0x44;
const MAX_NODE_STEPS: u32 = 50_000;
const GAME_UNITS_PER_MAP_UNIT: f32 = 96.0;
const MAP_UNITS_PER_CELL: f32 = 32.0;
const GAME_UNITS_PER_CELL: f32 = GAME_UNITS_PER_MAP_UNIT * MAP_UNITS_PER_CELL;

const OFFICIAL_CONTEXT_ROOT: u32 = 0x5a0e70;
const OFFICIAL_AGENT_ARRAY: u32 = 0x5a4de8;
const RELOCATED_CONTEXT_ROOT: u32 = 0x5a29b0;
const RELOCATED_AGENT_ARRAY: u32 = 0x5a6928;
const LAYOUT_OFFICIAL: u32 = 1;
const LAYOUT_RELOCATED: u32 = 2;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

fn memory_bytes() -> u32 {
    core::arch::wasm32::memory_size(0)
        .saturating_mul(65_536)
        .min(u32::MAX as usize) as u32
}

fn contains(address: u32, bytes: u32) -> bool {
    address.checked_add(bytes).is_some_and(|end| end <= memory_bytes())
}

fn add(base: u32, offset: u32) -> Option<u32> {
    base.checked_add(offset)
}

fn indexed(base: u32, index: u32, stride: u32) -> Option<u32> {
    base.checked_add(index.checked_mul(stride)?)
}

unsafe fn u32_at(address: u32) -> Option<u32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const u32) })
}

unsafe fn u16_at(address: u32) -> Option<u16> {
    contains(address, 2).then(|| unsafe { read_volatile(address as *const u16) })
}

unsafe fn f32_at(address: u32) -> Option<f32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const f32) })
}

unsafe fn pointer_at(address: u32, required: u32) -> Option<u32> {
    let pointer = unsafe { u32_at(address)? };
    (pointer != 0 && pointer & 3 == 0 && contains(pointer, required)).then_some(pointer)
}

unsafe fn store_u32(address: u32, value: u32) {
    if contains(address, 4) {
        unsafe { write_volatile(address as *mut u32, value) };
    }
}

unsafe fn store_f32(address: u32, value: f32) {
    if contains(address, 4) {
        unsafe { write_volatile(address as *mut f32, value) };
    }
}

unsafe fn array(address: u32, stride: u32, maximum: u32) -> Option<(u32, u32)> {
    if !contains(address, 12) {
        return None;
    }
    let buffer = unsafe { u32_at(address)? };
    let capacity = unsafe { u32_at(add(address, 4)?)? };
    let size = unsafe { u32_at(add(address, 8)?)? };
    // Capacity is allocator bookkeeping, not live pathing. Guild Wars may
    // retain a large spare allocation while publishing a small valid array;
    // only the actual size controls how much memory this kernel reads.
    if size > capacity || size > maximum {
        return None;
    }
    if size == 0 {
        return Some((0, 0));
    }
    let bytes = size.checked_mul(stride)?;
    (buffer != 0 && buffer & 3 == 0 && contains(buffer, bytes)).then_some((buffer, size))
}

#[derive(Clone, Copy)]
struct Plane {
    traps: u32,
    trap_count: u32,
    portals: u32,
    portal_count: u32,
    first_trap: u32,
}

impl Plane {
    const EMPTY: Self = Self {
        traps: 0,
        trap_count: 0,
        portals: 0,
        portal_count: 0,
        first_trap: 0,
    };
}

#[derive(Clone, Copy)]
struct Context {
    map_context: u32,
    path: u32,
    map_buffer: u32,
    map_count: u32,
    player_x: f32,
    player_y: f32,
    player_plane: u32,
    resource: u32,
}

unsafe fn resolve_layout(
    context_root: u32,
    agent_array: u32,
    map_id: u32,
    player_id: u32,
) -> Result<Context, u32> {
    let contexts = unsafe {
        pointer_at(context_root, (GAME_CONTEXT_SLOT + 1) * 4)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    let game = unsafe {
        pointer_at(
            indexed(contexts, GAME_CONTEXT_SLOT, 4).ok_or(STATUS_UNAVAILABLE)?,
            MAP_CONTEXT + 4,
        )
        .ok_or(STATUS_UNAVAILABLE)?
    };
    let map_context = unsafe {
        pointer_at(
            add(game, MAP_CONTEXT).ok_or(STATUS_UNAVAILABLE)?,
            PROPS_CONTEXT + 4,
        )
        .ok_or(STATUS_UNAVAILABLE)?
    };
    let path = unsafe {
        pointer_at(
            add(map_context, PATH_CONTEXT).ok_or(STATUS_UNAVAILABLE)?,
            0x10,
        )
        .ok_or(STATUS_UNAVAILABLE)?
    };
    if unsafe {
        u32_at(add(map_context, MAP_CONTEXT_MAP_ID).ok_or(STATUS_UNAVAILABLE)?)
            .ok_or(STATUS_UNAVAILABLE)?
    } != map_id {
        return Err(STATUS_UNAVAILABLE);
    }
    let static_data = unsafe {
        pointer_at(
            add(path, STATIC_DATA).ok_or(STATUS_UNAVAILABLE)?,
            STATIC_MAP_ARRAY + 12,
        )
        .ok_or(STATUS_UNAVAILABLE)?
    };
    let maps = add(static_data, STATIC_MAP_ARRAY).ok_or(STATUS_UNAVAILABLE)?;
    let map_count = unsafe {
        u32_at(add(maps, 8).ok_or(STATUS_UNAVAILABLE)?)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    if map_count > MAX_PLANES as u32 {
        return Err(STATUS_PLANE_LIMIT);
    }
    let (map_buffer, map_count) = unsafe {
        array(maps, PATHING_MAP_BYTES, MAX_PLANES as u32)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    if map_count == 0 {
        return Err(STATUS_UNAVAILABLE);
    }

    let (agent_buffer, agent_count) = unsafe {
        array(agent_array, 4, 4_096).ok_or(STATUS_UNAVAILABLE)?
    };
    if player_id == 0 || player_id >= agent_count {
        return Err(STATUS_UNAVAILABLE);
    }
    let agent = unsafe {
        pointer_at(
            indexed(agent_buffer, player_id, 4).ok_or(STATUS_UNAVAILABLE)?,
            0x80,
        )
        .ok_or(STATUS_UNAVAILABLE)?
    };
    if unsafe {
        u32_at(add(agent, 0x2c).ok_or(STATUS_UNAVAILABLE)?)
            .ok_or(STATUS_UNAVAILABLE)?
    } != player_id {
        return Err(STATUS_UNAVAILABLE);
    }
    let player_x = unsafe {
        f32_at(add(agent, 0x74).ok_or(STATUS_UNAVAILABLE)?)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    let player_y = unsafe {
        f32_at(add(agent, 0x78).ok_or(STATUS_UNAVAILABLE)?)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    let player_plane = unsafe {
        u32_at(add(agent, 0x7c).ok_or(STATUS_UNAVAILABLE)?)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    // The game may publish an out-of-range plane while the player stands in a
    // portal seam. GWToolbox treats the plane as a hint and searches every
    // valid map plane when that happens, so retain it for the bounded fallback.
    if !player_x.is_finite() || !player_y.is_finite() {
        return Err(STATUS_UNAVAILABLE);
    }
    Ok(Context {
        map_context,
        path,
        map_buffer,
        map_count,
        player_x,
        player_y,
        player_plane,
        resource: map_buffer,
    })
}

unsafe fn context(layout_id: u32, map_id: u32, player_id: u32) -> Result<Context, u32> {
    match layout_id {
        LAYOUT_OFFICIAL => unsafe {
            resolve_layout(OFFICIAL_CONTEXT_ROOT, OFFICIAL_AGENT_ARRAY, map_id, player_id)
        },
        LAYOUT_RELOCATED => unsafe {
            resolve_layout(RELOCATED_CONTEXT_ROOT, RELOCATED_AGENT_ARRAY, map_id, player_id)
        },
        _ => Err(STATUS_AMBIGUOUS_LAYOUT),
    }
}

unsafe fn load_planes(context: Context) -> Result<([Plane; MAX_PLANES], u32), u32> {
    let mut planes = [Plane::EMPTY; MAX_PLANES];
    let mut total = 0_u32;
    for index in 0..context.map_count {
        let map = indexed(context.map_buffer, index, PATHING_MAP_BYTES).ok_or(STATUS_UNAVAILABLE)?;
        let trap_count = unsafe { u32_at(add(map, 0x14).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
        let traps = if trap_count == 0 {
            0
        } else {
            unsafe { pointer_at(add(map, 0x18).ok_or(STATUS_UNAVAILABLE)?, trap_count.checked_mul(TRAP_BYTES).ok_or(STATUS_LIMIT)?).ok_or(STATUS_UNAVAILABLE)? }
        };
        let portal_count = unsafe { u32_at(add(map, 0x3c).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
        let portals = if portal_count == 0 {
            0
        } else {
            unsafe { pointer_at(add(map, 0x40).ok_or(STATUS_UNAVAILABLE)?, portal_count.checked_mul(PORTAL_BYTES).ok_or(STATUS_LIMIT)?).ok_or(STATUS_UNAVAILABLE)? }
        };
        if total.checked_add(trap_count).is_none_or(|sum| sum > MAX_TRAPS) {
            return Err(STATUS_TRAPEZOID_LIMIT);
        }
        // `index < MAX_PLANES` is proved by the loop bound. Avoid Rust's
        // bounds-panic formatting surface: this module must remain fully PIC.
        unsafe {
            *planes.get_unchecked_mut(index as usize) = Plane {
                traps,
                trap_count,
                portals,
                portal_count,
                first_trap: total,
            };
        }
        total += trap_count;
    }
    if total == 0 {
        return Err(STATUS_UNAVAILABLE);
    }
    Ok((planes, total))
}

fn floor_i32(value: f32) -> Option<i32> {
    if !value.is_finite() || value < i32::MIN as f32 || value > i32::MAX as f32 {
        return None;
    }
    let truncated = value as i32;
    Some(if value < truncated as f32 { truncated - 1 } else { truncated })
}

unsafe fn trap_values(trap: u32) -> Option<[f32; 6]> {
    let values = [
        unsafe { f32_at(add(trap, 0x18)?)? },
        unsafe { f32_at(add(trap, 0x1c)?)? },
        unsafe { f32_at(add(trap, 0x20)?)? },
        unsafe { f32_at(add(trap, 0x24)?)? },
        unsafe { f32_at(add(trap, 0x28)?)? },
        unsafe { f32_at(add(trap, 0x2c)?)? },
    ];
    values.iter().all(|value| value.is_finite()).then_some(values)
}

/**
 * Resolve the game's pathing sink for one plane through its bounded BSP tree.
 * This deliberately matches GWToolbox++ FindTrapezoid instead of testing the
 * rendered polygon. Near map borders the game can assign the player to a sink
 * whose polygon edge differs by floating-point noise from the agent position.
 */
unsafe fn find_trapezoid(map: u32, x: f32, y: f32) -> Option<u32> {
    let mut node = unsafe { pointer_at(add(map, ROOT_NODE)?, 8)? };
    for _ in 0..MAX_NODE_STEPS {
        let kind = unsafe { u32_at(node)? };
        node = match kind {
            // XNode: choose a side of the directed partition line.
            0 => {
                if !contains(node, 0x20) { return None; }
                let pos_x = unsafe { f32_at(add(node, 0x08)?)? };
                let pos_y = unsafe { f32_at(add(node, 0x0c)?)? };
                let dir_x = unsafe { f32_at(add(node, 0x10)?)? };
                let dir_y = unsafe { f32_at(add(node, 0x14)?)? };
                if ![pos_x, pos_y, dir_x, dir_y].iter().all(|value| value.is_finite()) {
                    return None;
                }
                let child = if (y - pos_y) * dir_x - (x - pos_x) * dir_y >= 0.0 {
                    add(node, 0x1c)?
                } else {
                    add(node, 0x18)?
                };
                unsafe { pointer_at(child, 8)? }
            }
            // YNode: equality is owned by the side selected from X.
            1 => {
                if !contains(node, 0x18) { return None; }
                let pos_x = unsafe { f32_at(add(node, 0x08)?)? };
                let pos_y = unsafe { f32_at(add(node, 0x0c)?)? };
                if !pos_x.is_finite() || !pos_y.is_finite() { return None; }
                let above = y > pos_y || (y == pos_y && x >= pos_x);
                unsafe { pointer_at(add(node, if above { 0x10 } else { 0x14 })?, 8)? }
            }
            // SinkNode owns the exact trapezoid selected by the client.
            2 => return unsafe { pointer_at(add(node, 0x08)?, TRAP_BYTES) },
            _ => return None,
        };
    }
    None
}

fn locate(planes: &[Plane; MAX_PLANES], plane_count: u32, trap: u32) -> Option<(u32, u32)> {
    for plane_index in 0..plane_count {
        let plane = unsafe { *planes.get_unchecked(plane_index as usize) };
        let bytes = plane.trap_count.checked_mul(TRAP_BYTES)?;
        if trap >= plane.traps && trap < plane.traps.checked_add(bytes)? {
            let offset = trap - plane.traps;
            if offset % TRAP_BYTES == 0 {
                return Some((plane_index, plane.first_trap + offset / TRAP_BYTES));
            }
        }
    }
    None
}

unsafe fn bit(region: u32, base: u32, index: u32) -> Option<bool> {
    let address = add(region, base.checked_add((index / 32) * 4)?)?;
    Some((unsafe { u32_at(address)? } & (1 << (index & 31))) != 0)
}

unsafe fn set_bit(region: u32, base: u32, index: u32) -> Option<()> {
    let address = add(region, base.checked_add((index / 32) * 4)?)?;
    let value = unsafe { u32_at(address)? } | (1 << (index & 31));
    unsafe { store_u32(address, value) };
    Some(())
}

unsafe fn clear_words(region: u32, base: u32, words: u32) {
    for word in 0..words {
        if let Some(address) = add(region, base + word * 4) {
            unsafe { store_u32(address, 0) };
        }
    }
}

fn file_id(c0: u16, c1: u16, c2: u16, c3: u16) -> u32 {
    if c0 <= 0xff || c1 <= 0xff || !(c2 == 0 || (c2 > 0xff && c3 == 0)) {
        return 0;
    }
    (c0 as u32)
        .wrapping_sub(0x00ff_00ff)
        .wrapping_add((c1 as u32).wrapping_mul(0xff00))
}

fn travel_model(value: u32) -> bool {
    matches!(value, 0x4e6b2 | 0x3c5ac | 0xa825 | 0xe723 | 0x858b | 0x28da0 | 0x1c533 | 0x5e77a)
}

unsafe fn build_doorways(region: u32, context: Context) -> Result<u32, u32> {
    let Some(props_context) = (unsafe {
        pointer_at(add(context.map_context, PROPS_CONTEXT).ok_or(STATUS_UNAVAILABLE)?, 0x1a0)
    }) else {
        return Ok(0);
    };
    let (props, count) = unsafe {
        array(add(props_context, 0x194).ok_or(STATUS_UNAVAILABLE)?, 4, 4_096)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    let mut written = 0_u32;
    for index in 0..count {
        let Some(prop) = (unsafe { pointer_at(indexed(props, index, 4).ok_or(STATUS_UNAVAILABLE)?, 0x58) }) else {
            continue;
        };
        let Some(model) = (unsafe { pointer_at(add(prop, 0x54).ok_or(STATUS_UNAVAILABLE)?, 0x0c) }) else {
            continue;
        };
        let Some(name) = (unsafe { pointer_at(add(model, 0x04).ok_or(STATUS_UNAVAILABLE)?, 8) }) else {
            continue;
        };
        let id = file_id(
            unsafe { u16_at(name).unwrap_or(0) },
            unsafe { u16_at(add(name, 2).ok_or(STATUS_UNAVAILABLE)?).unwrap_or(0) },
            unsafe { u16_at(add(name, 4).ok_or(STATUS_UNAVAILABLE)?).unwrap_or(0) },
            unsafe { u16_at(add(name, 6).ok_or(STATUS_UNAVAILABLE)?).unwrap_or(0) },
        );
        if !travel_model(id) {
            continue;
        }
        if written >= MAX_DOORWAYS {
            return Err(STATUS_DOORWAY_LIMIT);
        }
        let x = unsafe { f32_at(add(prop, 0x20).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
        let y = unsafe { f32_at(add(prop, 0x24).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
        let scale = unsafe { f32_at(add(prop, 0x50).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
        let bound = unsafe { f32_at(add(model, 0x08).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
        if !x.is_finite() || !y.is_finite() || !scale.is_finite() || !bound.is_finite() {
            return Err(STATUS_UNAVAILABLE);
        }
        let radius = if scale > 0.0 && bound > 0.0 { scale * bound } else { 400.0 };
        let radius_sq = radius * radius;
        let player_dx = context.player_x - x;
        let player_dy = context.player_y - y;
        if player_dx * player_dx + player_dy * player_dy < radius_sq {
            continue;
        }
        let doorway = add(region, DOORWAYS + written * DOORWAY_BYTES).ok_or(STATUS_LIMIT)?;
        unsafe {
            write_volatile(doorway as *mut f32, x);
            write_volatile(add(doorway, 4).ok_or(STATUS_LIMIT)? as *mut f32, y);
            write_volatile(add(doorway, 8).ok_or(STATUS_LIMIT)? as *mut f32, radius_sq);
        }
        written += 1;
    }
    Ok(written)
}

unsafe fn centre(trap: u32) -> Option<(f32, f32)> {
    let [xtl, xtr, yt, xbl, xbr, yb] = unsafe { trap_values(trap)? };
    Some(((xtl + xtr + xbl + xbr) * 0.25, (yt + yb) * 0.5))
}

unsafe fn crosses_doorway(region: u32, count: u32, from: (f32, f32), to: (f32, f32)) -> bool {
    let dx = to.0 - from.0;
    let dy = to.1 - from.1;
    let length_sq = dx * dx + dy * dy;
    for index in 0..count {
        let Some(address) = add(region, DOORWAYS + index * DOORWAY_BYTES) else {
            return true;
        };
        let (Some(x), Some(y), Some(radius_sq)) = (unsafe {
            (f32_at(address), f32_at(add(address, 4).unwrap_or(0)), f32_at(add(address, 8).unwrap_or(0)))
        }) else {
            return true;
        };
        let mut t = 0.0;
        if length_sq > 0.0 {
            t = (((x - from.0) * dx + (y - from.1) * dy) / length_sq).clamp(0.0, 1.0);
        }
        let ox = from.0 + dx * t - x;
        let oy = from.1 + dy * t - y;
        if ox * ox + oy * oy < radius_sq {
            return true;
        }
    }
    false
}

unsafe fn enqueue(
    region: u32,
    planes: &[Plane; MAX_PLANES],
    plane_count: u32,
    trap: u32,
    expected_plane: u32,
    tail: &mut u32,
) -> Result<(), u32> {
    let Some((actual_plane, global_index)) = locate(planes, plane_count, trap) else {
        return Err(STATUS_UNAVAILABLE);
    };
    if actual_plane != expected_plane {
        return Err(STATUS_UNAVAILABLE);
    }
    if unsafe { bit(region, VISITED_BITS, global_index).ok_or(STATUS_UNAVAILABLE)? } {
        return Ok(());
    }
    if *tail >= MAX_TRAPS {
        return Err(STATUS_TRAPEZOID_LIMIT);
    }
    unsafe { set_bit(region, VISITED_BITS, global_index).ok_or(STATUS_UNAVAILABLE)? };
    unsafe {
        store_u32(add(region, QUEUE_POINTERS + *tail * 4).ok_or(STATUS_LIMIT)?, trap);
        store_u32(add(region, QUEUE_PLANES + *tail * 4).ok_or(STATUS_LIMIT)?, expected_plane);
    }
    *tail += 1;
    Ok(())
}

unsafe fn blocked(context: Context, plane: u32) -> Result<bool, u32> {
    let (buffer, count) = unsafe {
        array(add(context.path, BLOCKED_PLANES).ok_or(STATUS_UNAVAILABLE)?, 4, MAX_PLANES as u32)
            .ok_or(STATUS_UNAVAILABLE)?
    };
    if plane >= count {
        return Ok(false);
    }
    Ok(unsafe { u32_at(indexed(buffer, plane, 4).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? } & 1 != 0)
}

unsafe fn expand_portal(
    region: u32,
    context: Context,
    planes: &[Plane; MAX_PLANES],
    plane_index: u32,
    portal_index: u16,
    from: (f32, f32),
    doorway_count: u32,
    tail: &mut u32,
) -> Result<(), u32> {
    let plane = unsafe { *planes.get_unchecked(plane_index as usize) };
    if portal_index as u32 >= plane.portal_count {
        return Ok(());
    }
    let portal = indexed(plane.portals, portal_index as u32, PORTAL_BYTES).ok_or(STATUS_UNAVAILABLE)?;
    if unsafe { u32_at(add(portal, 4).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? } & 0x04 != 0 {
        return Ok(());
    }
    let target_plane = unsafe { u16_at(add(portal, 2).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? } as u32;
    if target_plane >= context.map_count || unsafe { blocked(context, target_plane)? } {
        return Ok(());
    }
    let Some(pair) = (unsafe { pointer_at(add(portal, 8).ok_or(STATUS_UNAVAILABLE)?, PORTAL_BYTES) }) else {
        return Ok(());
    };
    let count = unsafe { u32_at(add(pair, 0x0c).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
    if count > MAX_TRAPS {
        return Err(STATUS_TRAPEZOID_LIMIT);
    }
    let traps = if count == 0 {
        return Ok(());
    } else {
        unsafe { pointer_at(add(pair, 0x10).ok_or(STATUS_UNAVAILABLE)?, count.checked_mul(4).ok_or(STATUS_LIMIT)?).ok_or(STATUS_UNAVAILABLE)? }
    };
    for index in 0..count {
        let Some(trap) = (unsafe { pointer_at(indexed(traps, index, 4).ok_or(STATUS_UNAVAILABLE)?, TRAP_BYTES) }) else {
            continue;
        };
        let to = unsafe { centre(trap).ok_or(STATUS_UNAVAILABLE)? };
        if unsafe { crosses_doorway(region, doorway_count, from, to) } {
            continue;
        }
        unsafe { enqueue(region, planes, context.map_count, trap, target_plane, tail)? };
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct Point {
    x: f32,
    y: f32,
}

fn clipped_area(values: [f32; 6], left: f32, bottom: f32, right: f32, top: f32) -> f32 {
    let [xtl, xtr, yt, xbl, xbr, yb] = values;
    let mut a = [Point { x: 0.0, y: 0.0 }; 8];
    let mut b = a;
    a[0] = Point { x: xtl, y: yt };
    a[1] = Point { x: xtr, y: yt };
    a[2] = Point { x: xbr, y: yb };
    a[3] = Point { x: xbl, y: yb };
    let mut count = 4_usize;
    for edge in 0..4 {
        if count == 0 {
            return 0.0;
        }
        let mut output = 0_usize;
        let mut from = unsafe { *a.get_unchecked(count - 1) };
        let mut from_inside = match edge {
            0 => from.x >= left,
            1 => from.x <= right,
            2 => from.y >= bottom,
            _ => from.y <= top,
        };
        for to in a[..count].iter().copied() {
            let to_inside = match edge {
                0 => to.x >= left,
                1 => to.x <= right,
                2 => to.y >= bottom,
                _ => to.y <= top,
            };
            if to_inside != from_inside {
                let point = if edge < 2 {
                    let x = if edge == 0 { left } else { right };
                    let ratio = (x - from.x) / (to.x - from.x);
                    Point { x, y: from.y + (to.y - from.y) * ratio }
                } else {
                    let y = if edge == 2 { bottom } else { top };
                    let ratio = (y - from.y) / (to.y - from.y);
                    Point { x: from.x + (to.x - from.x) * ratio, y }
                };
                if output >= b.len() { return 0.0; }
                unsafe { *b.get_unchecked_mut(output) = point };
                output += 1;
            }
            if to_inside {
                if output >= b.len() { return 0.0; }
                unsafe { *b.get_unchecked_mut(output) = to };
                output += 1;
            }
            from = to;
            from_inside = to_inside;
        }
        a = b;
        count = output;
    }
    let mut twice = 0.0;
    for index in 0..count {
        let current = unsafe { *a.get_unchecked(index) };
        let next = unsafe { *a.get_unchecked((index + 1) % count) };
        twice += current.x * next.y - next.x * current.y;
    }
    twice.abs() * 0.5
}

unsafe fn rasterize_trap_cells(
    region: u32,
    bits: u32,
    values: [f32; 6],
    anchor_x: f32,
    anchor_y: f32,
    width: u32,
    height: u32,
) -> Result<u32, u32> {
    let map_x = |game_x: f32| anchor_x + game_x / GAME_UNITS_PER_MAP_UNIT;
    let map_y = |game_y: f32| anchor_y - game_y / GAME_UNITS_PER_MAP_UNIT;
    let min_x = map_x(values[0]).min(map_x(values[1])).min(map_x(values[3])).min(map_x(values[4]));
    let max_x = map_x(values[0]).max(map_x(values[1])).max(map_x(values[3])).max(map_x(values[4]));
    let min_y = map_y(values[2]).min(map_y(values[5]));
    let max_y = map_y(values[2]).max(map_y(values[5]));
    let first_x = floor_i32(min_x / MAP_UNITS_PER_CELL).ok_or(STATUS_UNAVAILABLE)?;
    let last_x = floor_i32((max_x - 1e-4) / MAP_UNITS_PER_CELL).ok_or(STATUS_UNAVAILABLE)?;
    let first_y = floor_i32(min_y / MAP_UNITS_PER_CELL).ok_or(STATUS_UNAVAILABLE)?;
    let last_y = floor_i32((max_y - 1e-4) / MAP_UNITS_PER_CELL).ok_or(STATUS_UNAVAILABLE)?;
    let mut added = 0_u32;
    for cell_y in first_y..=last_y {
        for cell_x in first_x..=last_x {
            if cell_x < 0 || cell_y < 0 || cell_x >= width as i32 || cell_y >= height as i32 {
                continue;
            }
            let game_left = (cell_x as f32 * MAP_UNITS_PER_CELL - anchor_x) * GAME_UNITS_PER_MAP_UNIT;
            let game_right = game_left + GAME_UNITS_PER_CELL;
            let game_top = (anchor_y - cell_y as f32 * MAP_UNITS_PER_CELL) * GAME_UNITS_PER_MAP_UNIT;
            let game_bottom = game_top - GAME_UNITS_PER_CELL;
            if clipped_area(values, game_left, game_bottom, game_right, game_top) <= 1e-4 {
                continue;
            }
            let index = cell_y as u32 * width + cell_x as u32;
            if !unsafe { bit(region, bits, index).ok_or(STATUS_UNAVAILABLE)? } {
                unsafe { set_bit(region, bits, index).ok_or(STATUS_UNAVAILABLE)? };
                added = added.checked_add(1).ok_or(STATUS_LIMIT)?;
            }
        }
    }
    Ok(added)
}

fn cell_center_in_bounds(
    cell_x: i32,
    cell_y: i32,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
) -> bool {
    let center_x = (cell_x as f32 + 0.5) * MAP_UNITS_PER_CELL;
    let center_y = (cell_y as f32 + 0.5) * MAP_UNITS_PER_CELL;
    center_x >= min_x && center_x < max_x && center_y >= min_y && center_y < max_y
}

unsafe fn any_cell_in_ring(
    region: u32,
    bits: u32,
    width: u32,
    height: u32,
    center_x: i32,
    center_y: i32,
    radius: i32,
) -> Result<bool, u32> {
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let x = center_x + dx;
            let y = center_y + dy;
            if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
                continue;
            }
            if unsafe { bit(region, bits, y as u32 * width + x as u32) }
                .ok_or(STATUS_UNAVAILABLE)?
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

unsafe fn rasterize(
    region: u32,
    planes: &[Plane; MAX_PLANES],
    plane_count: u32,
    tail: u32,
    anchor_x: f32,
    anchor_y: f32,
    width: u32,
    height: u32,
    map_min_x: f32,
    map_min_y: f32,
    map_max_x: f32,
    map_max_y: f32,
    reveal_radius: u32,
) -> Result<u32, u32> {
    let cells = width.checked_mul(height).ok_or(STATUS_INVALID_INPUT)?;
    let words = cells.div_ceil(32);
    unsafe { clear_words(region, REACHABLE_CELL_BITS, CELL_WORDS) };
    let mut ground_cells = 0_u32;
    for queue_index in 0..tail {
        let trap = unsafe { u32_at(add(region, QUEUE_POINTERS + queue_index * 4).ok_or(STATUS_LIMIT)?).ok_or(STATUS_UNAVAILABLE)? };
        let values = unsafe { trap_values(trap).ok_or(STATUS_UNAVAILABLE)? };
        let added = unsafe {
            rasterize_trap_cells(
                region, REACHABLE_CELL_BITS, values, anchor_x, anchor_y, width, height,
            )?
        };
        ground_cells = ground_cells.checked_add(added).ok_or(STATUS_LIMIT)?;
    }

    unsafe { clear_words(region, NAVMESH_CELL_BITS, CELL_WORDS) };
    for plane_index in 0..plane_count {
        let plane = unsafe { *planes.get_unchecked(plane_index as usize) };
        for trap_index in 0..plane.trap_count {
            let trap = indexed(plane.traps, trap_index, TRAP_BYTES).ok_or(STATUS_LIMIT)?;
            let values = unsafe { trap_values(trap).ok_or(STATUS_UNAVAILABLE)? };
            unsafe {
                rasterize_trap_cells(
                    region, NAVMESH_CELL_BITS, values, anchor_x, anchor_y, width, height,
                )?
            };
        }
    }

    unsafe { clear_words(region, CELL_BITS, words) };
    for index in 0..cells {
        if !unsafe { bit(region, REACHABLE_CELL_BITS, index).ok_or(STATUS_UNAVAILABLE)? } {
            continue;
        }
        let x = index % width;
        let y = index / width;
        let radius = reveal_radius as i32;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let target_x = x as i32 + dx;
                let target_y = y as i32 + dy;
                if target_x < 0 || target_y < 0
                    || target_x >= width as i32 || target_y >= height as i32
                {
                    continue;
                }
                let distance = dx.abs().max(dy.abs());
                let within_bounds = if distance <= 1 {
                    cell_center_in_bounds(
                        target_x, target_y,
                        map_min_x - MAP_UNITS_PER_CELL,
                        map_min_y - MAP_UNITS_PER_CELL,
                        map_max_x + MAP_UNITS_PER_CELL,
                        map_max_y + MAP_UNITS_PER_CELL,
                    )
                } else {
                    cell_center_in_bounds(
                        target_x, target_y, map_min_x, map_min_y, map_max_x, map_max_y,
                    ) && unsafe {
                        any_cell_in_ring(
                            region, NAVMESH_CELL_BITS, width, height, target_x, target_y, 1,
                        )?
                    }
                };
                if !within_bounds {
                    continue;
                }
                unsafe {
                    set_bit(region, CELL_BITS, target_y as u32 * width + target_x as u32)
                        .ok_or(STATUS_UNAVAILABLE)?
                };
            }
        }
    }
    Ok(ground_cells)
}

fn positive_ceil(value: f32) -> Option<u32> {
    if !value.is_finite() || value <= 0.0 || value > u32::MAX as f32 {
        return None;
    }
    let truncated = value as u32;
    Some(if value > truncated as f32 { truncated.checked_add(1)? } else { truncated })
}

/** Rasterize every pathing trapezoid for presentation, independent of reachability. */
unsafe fn rasterize_terrain(
    region: u32,
    planes: &[Plane; MAX_PLANES],
    plane_count: u32,
    anchor_x: f32,
    anchor_y: f32,
    map_min_x: f32,
    map_min_y: f32,
    map_max_x: f32,
    map_max_y: f32,
) -> Result<(u32, u32, f32), u32> {
    let map_width = map_max_x - map_min_x;
    let map_height = map_max_y - map_min_y;
    let mut map_units_per_pixel = MIN_VISUAL_MAP_UNITS_PER_PIXEL;
    let (width, height) = {
        let mut fit = None;
        for _ in 0..32 {
            let width = positive_ceil(map_width / map_units_per_pixel)
                .ok_or(STATUS_INVALID_INPUT)?;
            let height = positive_ceil(map_height / map_units_per_pixel)
                .ok_or(STATUS_INVALID_INPUT)?;
            if width.checked_mul(height)
                .is_some_and(|cells| cells > 0 && cells <= MAX_VISUAL_RASTER_CELLS)
            {
                fit = Some((width, height));
                break;
            }
            map_units_per_pixel *= 2.0;
        }
        fit.ok_or(STATUS_VISUAL_RASTER_LIMIT)?
    };
    unsafe { clear_words(region, VISUAL_BITS, VISUAL_WORDS) };
    for plane_index in 0..plane_count {
      let plane = unsafe { *planes.get_unchecked(plane_index as usize) };
      for trap_index in 0..plane.trap_count {
        let trap = indexed(plane.traps, trap_index, TRAP_BYTES).ok_or(STATUS_LIMIT)?;
        let values = unsafe { trap_values(trap).ok_or(STATUS_UNAVAILABLE)? };
        let map_x = |game_x: f32| anchor_x + game_x / GAME_UNITS_PER_MAP_UNIT;
        let map_y = |game_y: f32| anchor_y - game_y / GAME_UNITS_PER_MAP_UNIT;
        let min_x = map_x(values[0]).min(map_x(values[1])).min(map_x(values[3])).min(map_x(values[4]));
        let max_x = map_x(values[0]).max(map_x(values[1])).max(map_x(values[3])).max(map_x(values[4]));
        let min_y = map_y(values[2]).min(map_y(values[5]));
        let max_y = map_y(values[2]).max(map_y(values[5]));
        let first_x = floor_i32((min_x - map_min_x) / map_units_per_pixel)
            .ok_or(STATUS_UNAVAILABLE)?;
        let last_x = floor_i32((max_x - map_min_x - 1e-4) / map_units_per_pixel)
            .ok_or(STATUS_UNAVAILABLE)?;
        let first_y = floor_i32((min_y - map_min_y) / map_units_per_pixel)
            .ok_or(STATUS_UNAVAILABLE)?;
        let last_y = floor_i32((max_y - map_min_y - 1e-4) / map_units_per_pixel)
            .ok_or(STATUS_UNAVAILABLE)?;
        for pixel_y in first_y..=last_y {
            for pixel_x in first_x..=last_x {
                if pixel_x < 0 || pixel_y < 0 || pixel_x >= width as i32 || pixel_y >= height as i32 {
                    continue;
                }
                let map_left = map_min_x + pixel_x as f32 * map_units_per_pixel;
                let map_right = map_left + map_units_per_pixel;
                let map_top = map_min_y + pixel_y as f32 * map_units_per_pixel;
                let map_bottom = map_top + map_units_per_pixel;
                let game_left = (map_left - anchor_x) * GAME_UNITS_PER_MAP_UNIT;
                let game_right = (map_right - anchor_x) * GAME_UNITS_PER_MAP_UNIT;
                let game_top = (anchor_y - map_top) * GAME_UNITS_PER_MAP_UNIT;
                let game_bottom = (anchor_y - map_bottom) * GAME_UNITS_PER_MAP_UNIT;
                if clipped_area(values, game_left, game_bottom, game_right, game_top) > 1e-4 {
                    unsafe {
                        set_bit(region, VISUAL_BITS, pixel_y as u32 * width + pixel_x as u32)
                            .ok_or(STATUS_UNAVAILABLE)?;
                    }
                }
            }
        }
      }
    }
    Ok((width, height, map_units_per_pixel))
}

static mut RESOURCE_POINTER: u32 = 0;
static mut RESOURCE_GENERATION: u32 = 0;

#[derive(Clone, Copy)]
struct ReachabilityCache {
    resource: u32,
    map_id: u32,
    area_epoch: u32,
    blocked_fingerprint: u32,
    total_traps: u32,
    reachable_traps: u32,
    doorway_count: u32,
}

impl ReachabilityCache {
    const EMPTY: Self = Self {
        resource: 0,
        map_id: 0,
        area_epoch: 0,
        blocked_fingerprint: 0,
        total_traps: 0,
        reachable_traps: 0,
        doorway_count: 0,
    };
}

static mut REACHABILITY_CACHE: ReachabilityCache = ReachabilityCache::EMPTY;

unsafe fn blocked_fingerprint(context: Context) -> Result<u32, u32> {
    let (buffer, count) = unsafe {
        array(
            add(context.path, BLOCKED_PLANES).ok_or(STATUS_UNAVAILABLE)?,
            4,
            MAX_PLANES as u32,
        )
        .ok_or(STATUS_UNAVAILABLE)?
    };
    let mut fingerprint = 0x811c_9dc5_u32;
    for index in 0..count {
        let value = unsafe {
            u32_at(indexed(buffer, index, 4).ok_or(STATUS_UNAVAILABLE)?)
                .ok_or(STATUS_UNAVAILABLE)?
        };
        fingerprint = fingerprint.wrapping_mul(0x0100_0193) ^ value;
    }
    Ok(fingerprint.wrapping_mul(0x0100_0193) ^ count)
}

unsafe fn publish(
    region: u32,
    status: u32,
    map_id: u32,
    area_epoch: u32,
    layout_id: u32,
    width: u32,
    height: u32,
    total_traps: u32,
    reachable_traps: u32,
    ground_cells: u32,
    doorway_count: u32,
    visual_width: u32,
    visual_height: u32,
    visual_map_units_per_pixel: f32,
) {
    let previous = unsafe { u32_at(add(region, 12).unwrap_or(0)).unwrap_or(0) };
    let writing = previous.wrapping_add(1) | 1;
    unsafe {
        store_u32(add(region, 12).unwrap_or(0), writing);
        store_u32(region, MAGIC);
        store_u32(add(region, 4).unwrap_or(0), ABI);
        store_u32(add(region, 8).unwrap_or(0), REGION_BYTES);
        store_u32(add(region, 16).unwrap_or(0), status);
        store_u32(add(region, 20).unwrap_or(0), map_id);
        store_u32(add(region, 24).unwrap_or(0), area_epoch);
        store_u32(add(region, 28).unwrap_or(0), layout_id);
        store_u32(add(region, 32).unwrap_or(0), width);
        store_u32(add(region, 36).unwrap_or(0), height);
        store_u32(add(region, 40).unwrap_or(0), RESOURCE_GENERATION);
        store_u32(add(region, 44).unwrap_or(0), total_traps);
        store_u32(add(region, 48).unwrap_or(0), reachable_traps);
        store_u32(add(region, 52).unwrap_or(0), ground_cells);
        store_u32(add(region, 56).unwrap_or(0), doorway_count);
        store_u32(add(region, 60).unwrap_or(0), visual_width);
        store_u32(add(region, 64).unwrap_or(0), visual_height);
        store_f32(add(region, 68).unwrap_or(0), visual_map_units_per_pixel);
        store_u32(add(region, 12).unwrap_or(0), writing.wrapping_add(1));
    }
}

unsafe fn classify(
    region: u32,
    layout_id: u32,
    map_id: u32,
    area_epoch: u32,
    player_id: u32,
    anchor_x: f32,
    anchor_y: f32,
    width: u32,
    height: u32,
    map_min_x: f32,
    map_min_y: f32,
    map_max_x: f32,
    map_max_y: f32,
    reveal_radius: u32,
) -> Result<(u32, u32, u32, u32, u32, u32, f32), u32> {
    let context = unsafe { context(layout_id, map_id, player_id)? };
    if unsafe { RESOURCE_POINTER } != context.resource {
        unsafe {
            RESOURCE_POINTER = context.resource;
            RESOURCE_GENERATION = RESOURCE_GENERATION.wrapping_add(1).max(1);
        }
    }
    let (planes, total_traps) = unsafe { load_planes(context)? };
    let blocked_fingerprint = unsafe { blocked_fingerprint(context)? };
    let mut start = None;
    let has_player_plane = context.player_plane < context.map_count;
    let passes = context.map_count + u32::from(has_player_plane);
    for pass in 0..passes {
        let plane_index = if has_player_plane && pass == 0 {
            context.player_plane
        } else if has_player_plane {
            pass - 1
        } else {
            pass
        };
        if has_player_plane && pass > 0 && plane_index == context.player_plane { continue; }
        let map = indexed(context.map_buffer, plane_index, PATHING_MAP_BYTES)
            .ok_or(STATUS_UNAVAILABLE)?;
        if let Some(trap) = unsafe {
            find_trapezoid(map, context.player_x, context.player_y)
        } {
            // The sink must still belong to the certified plane array before
            // it can enter the bounded flood queue.
            if locate(&planes, context.map_count, trap)
                .is_some_and(|(actual_plane, _)| actual_plane == plane_index)
            {
                start = Some((trap, plane_index));
                break;
            }
        }
    }
    let cache = unsafe { REACHABILITY_CACHE };
    let cache_matches = cache.resource == context.resource
        && cache.map_id == map_id
        && cache.area_epoch == area_epoch
        && cache.blocked_fingerprint == blocked_fingerprint
        && cache.total_traps == total_traps
        && cache.reachable_traps > 0;
    // The client can briefly publish a position outside every pathing sink at
    // terrain seams. Keep the already-certified component while every owner
    // key is unchanged. A valid start outside it is a real component change.
    let reuse = cache_matches && start.is_none_or(|(trap, _)| {
        locate(&planes, context.map_count, trap)
            .and_then(|(_, global_index)| unsafe { bit(region, VISITED_BITS, global_index) })
            .unwrap_or(false)
    });
    let (tail, doorway_count) = if reuse {
        (cache.reachable_traps, cache.doorway_count)
    } else {
        let (start_trap, start_plane) = start.ok_or(STATUS_NO_START)?;
        unsafe {
            clear_words(region, VISITED_BITS, VISITED_WORDS);
        }
        let doorway_count = unsafe { build_doorways(region, context)? };
        let mut tail = 0_u32;
        unsafe { enqueue(region, &planes, context.map_count, start_trap, start_plane, &mut tail)? };
        let mut head = 0_u32;
        while head < tail {
            let trap = unsafe { u32_at(add(region, QUEUE_POINTERS + head * 4).ok_or(STATUS_LIMIT)?).ok_or(STATUS_UNAVAILABLE)? };
            let plane_index = unsafe { u32_at(add(region, QUEUE_PLANES + head * 4).ok_or(STATUS_LIMIT)?).ok_or(STATUS_UNAVAILABLE)? };
            let from = unsafe { centre(trap).ok_or(STATUS_UNAVAILABLE)? };
            for field in [0x04_u32, 0x08, 0x0c, 0x10] {
                let Some(adjacent) = (unsafe { pointer_at(add(trap, field).ok_or(STATUS_UNAVAILABLE)?, TRAP_BYTES) }) else {
                    continue;
                };
                let to = unsafe { centre(adjacent).ok_or(STATUS_UNAVAILABLE)? };
                if unsafe { crosses_doorway(region, doorway_count, from, to) } { continue; }
                unsafe { enqueue(region, &planes, context.map_count, adjacent, plane_index, &mut tail)? };
            }
            let left = unsafe { u16_at(add(trap, 0x14).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
            let right = unsafe { u16_at(add(trap, 0x16).ok_or(STATUS_UNAVAILABLE)?).ok_or(STATUS_UNAVAILABLE)? };
            unsafe {
                expand_portal(region, context, &planes, plane_index, left, from, doorway_count, &mut tail)?;
                if right != left {
                    expand_portal(region, context, &planes, plane_index, right, from, doorway_count, &mut tail)?;
                }
            }
            head += 1;
        }
        unsafe {
            REACHABILITY_CACHE = ReachabilityCache {
                resource: context.resource,
                map_id,
                area_epoch,
                blocked_fingerprint,
                total_traps,
                reachable_traps: tail,
                doorway_count,
            };
        }
        (tail, doorway_count)
    };
    unsafe { clear_words(region, CELL_BITS, CELL_WORDS) };
    let ground_cells = unsafe {
        rasterize(
            region,
            &planes,
            context.map_count,
            tail,
            anchor_x,
            anchor_y,
            width,
            height,
            map_min_x,
            map_min_y,
            map_max_x,
            map_max_y,
            reveal_radius,
        )?
    };
    let (visual_width, visual_height, visual_map_units_per_pixel) = unsafe {
        rasterize_terrain(
            region, &planes, context.map_count, anchor_x, anchor_y,
            map_min_x, map_min_y, map_max_x, map_max_y,
        )?
    };
    Ok((
        total_traps,
        tail,
        ground_cells,
        doorway_count,
        visual_width,
        visual_height,
        visual_map_units_per_pixel,
    ))
}

#[no_mangle]
pub unsafe extern "C" fn cartography_reachability_classify(
    region: u32,
    region_bytes: u32,
    layout_id: u32,
    map_id: u32,
    area_epoch: u32,
    player_id: u32,
    anchor_x: f32,
    anchor_y: f32,
    width: u32,
    height: u32,
    map_min_x: f32,
    map_min_y: f32,
    map_max_x: f32,
    map_max_y: f32,
    reveal_radius: u32,
) -> u32 {
    if region == 0 || region & 3 != 0 || region_bytes != REGION_BYTES
        || !contains(region, REGION_BYTES)
        || !(layout_id == LAYOUT_OFFICIAL || layout_id == LAYOUT_RELOCATED)
        || map_id == 0 || map_id > 2_000 || area_epoch == 0
        || player_id == 0 || width == 0 || height == 0
        || width.checked_mul(height).is_none_or(|cells| cells > MAX_CELLS)
        || !anchor_x.is_finite() || !anchor_y.is_finite()
        || !map_min_x.is_finite() || !map_min_y.is_finite()
        || !map_max_x.is_finite() || !map_max_y.is_finite()
        || map_min_x >= map_max_x || map_min_y >= map_max_y
        || !(reveal_radius == 1 || reveal_radius == 3)
    {
        if region != 0 && contains(region, HEADER_BYTES) {
            unsafe {
                publish(
                    region, STATUS_INVALID_INPUT, map_id, area_epoch, layout_id,
                    width, height, 0, 0, 0, 0, 0, 0, 0.0,
                )
            };
        }
        return STATUS_INVALID_INPUT;
    }
    match unsafe {
        classify(
            region, layout_id, map_id, area_epoch, player_id, anchor_x, anchor_y, width, height,
            map_min_x, map_min_y, map_max_x, map_max_y, reveal_radius,
        )
    } {
        Ok((
            total,
            reachable,
            ground,
            doorways,
            visual_width,
            visual_height,
            visual_map_units_per_pixel,
        )) => {
            unsafe {
                publish(
                    region, STATUS_READY, map_id, area_epoch, layout_id, width, height,
                    total, reachable, ground, doorways, visual_width, visual_height,
                    visual_map_units_per_pixel,
                )
            };
            STATUS_READY
        }
        Err(status) => {
            unsafe {
                clear_words(region, CELL_BITS, CELL_WORDS);
                clear_words(region, VISUAL_BITS, VISUAL_WORDS);
                publish(
                    region, status, map_id, area_epoch, layout_id, width, height,
                    0, 0, 0, 0, 0, 0, 0.0,
                );
            }
            status
        }
    }
}

#[no_mangle]
pub extern "C" fn cartography_reachability_abi() -> u32 { ABI }

#[no_mangle]
pub extern "C" fn cartography_reachability_region_bytes() -> u32 { REGION_BYTES }
