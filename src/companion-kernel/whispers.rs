//! Exact whisper chat-log observation for the certified client build.
//!
//! The UI event is shared rendered text, so this module accepts only channel
//! 14 or the outgoing global template, with a bounded control-code shape. It copies the sender and message
//! into its own bounded host region before the ephemeral game pointer expires.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::memory::{contains, indexed, offset, read_u16, read_u32};

const INCOMING_WHISPER_CHANNEL: u32 = 14;
const GLOBAL_CHANNEL: u32 = 10;
const OUTGOING_TEMPLATE: u16 = 0x076e;
const SENDER_STYLE: u16 = 0x0107;
const TEXT_STYLE: u16 = 0x0108;
const CONTROL_END: u16 = 0x0001;

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut WRITE_COUNT: u32 = 0;
static mut REJECTED_COUNT: u32 = 0;

unsafe fn rendered_units(pointer: u32) -> Option<u32> {
    if pointer == 0 || pointer & 1 != 0 {
        return None;
    }
    let maximum = (2 + WHISPER_SENDER_UNITS + 2 + WHISPER_MESSAGE_UNITS + 1) as u32;
    for index in 0..=maximum {
        let address = indexed(pointer, index, 2)?;
        if unsafe { read_u16(address)? } == 0 {
            return Some(index);
        }
    }
    None
}

unsafe fn parse(pointer: u32) -> Option<(u32, u32, u32)> {
    let units = unsafe { rendered_units(pointer)? };
    if units < 7
        || unsafe { read_u16(indexed(pointer, 1, 2)?) } != Some(SENDER_STYLE)
        || unsafe { read_u16(indexed(pointer, units - 1, 2)?) } != Some(CONTROL_END)
    {
        return None;
    }
    let maximum_separator = 2 + WHISPER_SENDER_UNITS as u32;
    for separator in 3..=maximum_separator.min(units.saturating_sub(4)) {
        if unsafe { read_u16(indexed(pointer, separator, 2)?) } == Some(CONTROL_END)
            && unsafe { read_u16(indexed(pointer, separator + 1, 2)?) } == Some(TEXT_STYLE)
        {
            let sender_units = separator - 2;
            let message_start = separator + 2;
            let message_units = units - message_start - 1;
            if sender_units == 0
                || sender_units > WHISPER_SENDER_UNITS as u32
                || message_units == 0
                || message_units > WHISPER_MESSAGE_UNITS as u32
            {
                return None;
            }
            return Some((sender_units, message_start, message_units));
        }
    }
    None
}

unsafe fn valid_utf16(pointer: u32, start: u32, units: u32) -> bool {
    let mut high = false;
    for index in start..start + units {
        let Some(unit) = indexed(pointer, index, 2).and_then(|at| unsafe { read_u16(at) }) else { return false; };
        if high {
            if !(0xdc00..=0xdfff).contains(&unit) { return false; }
            high = false;
        } else if (0xd800..=0xdbff).contains(&unit) { high = true; }
        else if (0xdc00..=0xdfff).contains(&unit) || unit == 0 { return false; }
    }
    !high
}

unsafe fn reject() {
    unsafe { REJECTED_COUNT = REJECTED_COUNT.saturating_add(1) };
    unsafe { publish_header() };
}

unsafe fn publish_header() {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut WhisperSnapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, WHISPER_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, WHISPER_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).write_count, WRITE_COUNT);
        write_volatile(&mut (*snapshot).rejected_count, REJECTED_COUNT);
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

unsafe fn append(text: u32, sender_units: u32, message_start: u32, message_units: u32, outgoing: bool) {
    let id = unsafe { WRITE_COUNT }.wrapping_add(1).max(1);
    let index = (id as usize - 1) % WHISPER_SLOT_COUNT;
    let snapshot = unsafe { POINTER as *mut WhisperSnapshot };
    let slot = unsafe { &mut (*snapshot).slots[index] };
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut slot.id, 0);
        write_volatile(
            &mut slot.sender_and_message_units,
            sender_units | message_units << 16 | if outgoing { 1 << 31 } else { 0 },
        );
        for index in 0..WHISPER_SENDER_UNITS {
            let value = if index < sender_units as usize {
                read_u16(indexed(text, index as u32 + 2, 2).unwrap_or(0)).unwrap_or(0)
            } else {
                0
            };
            write_volatile(&mut slot.sender[index], value);
        }
        for index in 0..WHISPER_MESSAGE_UNITS {
            let value = if index < message_units as usize {
                read_u16(indexed(text, message_start + index as u32, 2).unwrap_or(0)).unwrap_or(0)
            } else {
                0
            };
            write_volatile(&mut slot.message[index], value);
        }
        write_volatile(&mut slot.id, id);
        WRITE_COUNT = id;
        write_volatile(&mut (*snapshot).magic, WHISPER_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, WHISPER_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).write_count, WRITE_COUNT);
        write_volatile(&mut (*snapshot).rejected_count, REJECTED_COUNT);
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
        WRITE_COUNT = 0;
        REJECTED_COUNT = 0;
    }
    for index in 0..WHISPER_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish_header() };
}

pub(crate) unsafe fn observe(message: u32, wparam: u32) {
    if message != 0x1000_007f || wparam == 0 || wparam & 3 != 0 || !contains(wparam, 8) {
        return;
    }
    let channel = unsafe { read_u32(wparam) };
    if channel != Some(INCOMING_WHISPER_CHANNEL) && channel != Some(GLOBAL_CHANNEL) {
        return;
    }
    let text = offset(wparam, 4).and_then(|at| unsafe { read_u32(at) });
    let outgoing = channel == Some(GLOBAL_CHANNEL);
    if outgoing && text.and_then(|p| unsafe { read_u16(p) }) != Some(OUTGOING_TEMPLATE) {
        return;
    }
    let Some((text, (sender_units, message_start, message_units))) =
        text.and_then(|text| unsafe { parse(text) }.map(|shape| (text, shape)))
    else {
        unsafe { reject() };
        return;
    };
    if !unsafe { valid_utf16(text, 2, sender_units) }
        || !unsafe { valid_utf16(text, message_start, message_units) } {
        unsafe { reject() }; return;
    }
    unsafe { append(text, sender_units, message_start, message_units, outgoing) };
}

/// Rechecks the canonical game state on enqueue and at the native drain.
/// The only writable target is the mailbox owned by this initialized region.
pub(crate) unsafe fn authorize_send(layout: Layout, mailbox: u32, phase: u32, active: bool) {
    let expected = unsafe { POINTER }.checked_add(WHISPER_SNAPSHOT_BYTES);
    if unsafe { POINTER } == 0 || expected != Some(mailbox) || phase > 1 { return; }
    unsafe { write_volatile(mailbox as *mut u32, 3); }
    if !active { return; }
    let crate::GameState::Ready { game, map_id, play_region: PLAY_REGION_PVE, .. } =
        (unsafe { crate::resolve_game(layout) }) else { return; };
    let Some(key) = (unsafe { crate::play_region::current_character_key(layout, game) }) else { return; };
    if phase == 0 {
        unsafe {
            write_volatile((mailbox + 568) as *mut u32, key as u32);
            write_volatile((mailbox + 572) as *mut u32, (key >> 32) as u32);
            write_volatile((mailbox + 576) as *mut u32, map_id);
        }
    } else if unsafe { read_u32(mailbox + 568) } != Some(key as u32)
        || unsafe { read_u32(mailbox + 572) } != Some((key >> 32) as u32)
        || unsafe { read_u32(mailbox + 576) } != Some(map_id) { return; }
    unsafe { write_volatile(mailbox as *mut u32, 4); }
}
