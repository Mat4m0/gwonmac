use core::ptr::write_volatile;

use crate::abi::*;
use crate::memory::*;

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut GENERATION: u32 = 0;
static mut PUBLISHED: Published = Published::EMPTY;
static mut DIRTY: bool = true;
static mut EVENT_COUNT: u32 = 0;

#[derive(Clone, Copy)]
struct State {
    hash: u32,
    hotspot_x: u32,
    hotspot_y: u32,
    hidden: bool,
    source: u32,
}

// The active art pointer is not stable across cursor changes, so the pixel
// hash is the only usable published identity.
#[derive(Clone, Copy, PartialEq)]
struct Published {
    flags: u32,
    hash: u32,
    hotspot_x: u32,
    hotspot_y: u32,
}

impl Published {
    const EMPTY: Self = Self {
        flags: 0,
        hash: 0,
        hotspot_x: 0,
        hotspot_y: 0,
    };
}

// FNV-1a over the source BGRA words, so an unchanged cursor costs one pass and
// no conversion. None means unreadable or never committed by the game.
unsafe fn hash_pixels(source: u32) -> Option<u32> {
    let mut hash: u32 = 0x811c_9dc5;
    let mut committed: u32 = 0;
    for index in 0..CURSOR_WORDS {
        let word = unsafe { read_u32(indexed(source, index, 4)?)? };
        hash = (hash ^ word).wrapping_mul(0x0100_0193);
        committed |= word;
    }
    (committed != 0).then_some(hash)
}

// The readback that fills the colour buffer uses a hard-coded pitch, so a
// source texture that is not 32x32 would have misfilled it.
unsafe fn read(layout: Layout) -> Option<State> {
    let art = unsafe { pointer(layout.cursor_active_art, 24)? };
    let handle = unsafe { pointer(offset(art, layout.cursor_art_texture)?, 12)? };
    if unsafe { read_u32(offset(handle, layout.cursor_handle_key)?)? } != CURSOR_TEXTURE_KEY {
        return None;
    }
    let view = unsafe { pointer(offset(handle, layout.cursor_handle_object)?, 12)? };
    let texture = unsafe { pointer(offset(view, layout.cursor_view_texture)?, 0x68)? };
    if unsafe { read_u32(offset(texture, layout.cursor_texture_type)?)? } != CURSOR_TEXTURE_TYPE
        || unsafe { read_u32(offset(texture, layout.cursor_texture_width)?)? } != CURSOR_EDGE
        || unsafe { read_u32(offset(texture, layout.cursor_texture_height)?)? } != CURSOR_EDGE
    {
        return None;
    }

    let hotspot = offset(art, layout.cursor_art_hotspot)?;
    let hotspot_x = unsafe { read_u32(hotspot)? };
    let hotspot_y = unsafe { read_u32(offset(hotspot, 4)?)? };
    if hotspot_x >= CURSOR_EDGE || hotspot_y >= CURSOR_EDGE {
        return None;
    }

    let source = layout.cursor_color_buffer;
    if !contains(source, CURSOR_PIXEL_BYTES) {
        return None;
    }
    let hash = unsafe { hash_pixels(source)? };
    let hidden = unsafe { read_i32(layout.cursor_show_count) }.is_some_and(|count| count < 0);
    Some(State {
        hash,
        hotspot_x,
        hotspot_y,
        hidden,
        source,
    })
}

unsafe fn collect(layout: Layout) -> Result<State, u32> {
    if unsafe { read_u32(layout.cursor_software_model) } != Some(0) {
        return Err(FLAG_CURSOR_UNSUPPORTED);
    }
    unsafe { read(layout) }.ok_or(0)
}

// `source` is None for a header-only update: it clears CURSOR_VALID without
// disturbing the last good pixels.
unsafe fn publish(published: Published, source: Option<u32>) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let cursor = unsafe { POINTER as *mut CursorSnapshot };
    unsafe {
        write_volatile(&mut (*cursor).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*cursor).magic, CURSOR_MAGIC);
        write_volatile(&mut (*cursor).abi_and_size, CURSOR_ABI_AND_SIZE);
        write_volatile(&mut (*cursor).flags, published.flags);
    }
    if let Some(source) = source {
        unsafe {
            GENERATION = GENERATION.wrapping_add(1);
            write_volatile(&mut (*cursor).generation, GENERATION);
            write_volatile(&mut (*cursor).width, CURSOR_EDGE);
            write_volatile(&mut (*cursor).height, CURSOR_EDGE);
            write_volatile(&mut (*cursor).hotspot_x, published.hotspot_x);
            write_volatile(&mut (*cursor).hotspot_y, published.hotspot_y);
            write_volatile(&mut (*cursor).pixel_hash, published.hash);
        }
        for index in 0..CURSOR_WORDS {
            let word = indexed(source, index, 4)
                .and_then(|address| unsafe { read_u32(address) })
                .unwrap_or(0);
            // BGRA -> RGBA: keep alpha and green, swap red and blue.
            let rgba = (word & 0xff00_ff00) | ((word >> 16) & 0xff) | ((word & 0xff) << 16);
            unsafe { write_volatile(&mut (*cursor).pixels[index as usize], rgba) };
        }
    }
    unsafe {
        write_volatile(&mut (*cursor).sequence, next);
        SEQUENCE = next;
        PUBLISHED = published;
    }
}

pub(crate) unsafe fn tick(layout: Layout) {
    if !unsafe { DIRTY } {
        let last = unsafe { PUBLISHED };
        if last.flags & FLAG_CURSOR_VALID == 0 {
            return;
        }
        if let Some(count) = unsafe { read_i32(layout.cursor_show_count) } {
            let flags = FLAG_CURSOR_VALID | if count < 0 { FLAG_CURSOR_HIDDEN } else { 0 };
            if flags != last.flags {
                unsafe { publish(Published { flags, ..last }, None) };
            }
        }
        return;
    }
    unsafe { DIRTY = false };
    let last = unsafe { PUBLISHED };
    match unsafe { collect(layout) } {
        Ok(state) => {
            let published = Published {
                flags: FLAG_CURSOR_VALID | if state.hidden { FLAG_CURSOR_HIDDEN } else { 0 },
                hash: state.hash,
                hotspot_x: state.hotspot_x,
                hotspot_y: state.hotspot_y,
            };
            if published != last {
                // Show/hide moves the flags alone, and the region already holds
                // the bitmap `published.hash` names, so skip the 4 KB rewrite.
                let bitmap = last.flags & FLAG_CURSOR_VALID == 0
                    || published.hash != last.hash
                    || published.hotspot_x != last.hotspot_x
                    || published.hotspot_y != last.hotspot_y;
                unsafe { publish(published, bitmap.then_some(state.source)) };
            }
        }
        Err(flags) => {
            if flags != last.flags {
                unsafe { publish(Published { flags, ..last }, None) };
            }
        }
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
        GENERATION = 0;
        PUBLISHED = Published::EMPTY;
        DIRTY = true;
        EVENT_COUNT = 0;
    }
    let cursor = pointer as *mut CursorSnapshot;
    unsafe {
        write_volatile(&mut (*cursor).generation, 0);
        write_volatile(&mut (*cursor).width, 0);
        write_volatile(&mut (*cursor).height, 0);
        write_volatile(&mut (*cursor).hotspot_x, 0);
        write_volatile(&mut (*cursor).hotspot_y, 0);
        write_volatile(&mut (*cursor).pixel_hash, 0);
    }
    for index in 0..6 {
        unsafe { write_volatile(&mut (*cursor).reserved[index], 0) };
    }
    for index in 0..CURSOR_WORDS {
        unsafe { write_volatile(&mut (*cursor).pixels[index as usize], 0) };
    }
    unsafe { publish(Published::EMPTY, None) };
}

pub(crate) unsafe fn mark_dirty() {
    unsafe {
        EVENT_COUNT = EVENT_COUNT.saturating_add(1);
        DIRTY = true;
    }
}

pub(crate) unsafe fn event_count() -> u32 {
    unsafe { EVENT_COUNT }
}
