//! Exact whisper chat-log observation for the certified client build.
//!
//! The UI events carry either shared rendered whisper text or a separate public
//! chat sender. This module accepts only the known player-chat channels and
//! bounded control-code shapes. It copies whisper content or public sender names
//! into its own bounded host region before the ephemeral game pointer expires.

use core::ptr::write_volatile;

use crate::abi::*;
use crate::memory::{checked_mul, contains, indexed, offset, pointer, read_u16, read_u32};

const INCOMING_WHISPER_CHANNEL: u32 = 14;
const GLOBAL_CHANNEL: u32 = 10;
const ALLIANCE_CHANNEL: u32 = 0;
const ALLIES_CHANNEL: u32 = 1;
const ALL_CHANNEL: u32 = 3;
const GUILD_CHANNEL: u32 = 9;
const GROUP_CHANNEL: u32 = 11;
const TRADE_CHANNEL: u32 = 12;
const OUTGOING_TEMPLATE: u16 = 0x076e;
const SENDER_STYLE: u16 = 0x0107;
const TEXT_STYLE: u16 = 0x0108;
const CONTROL_END: u16 = 0x0001;
// The certified Player row is 0x50 bytes. Its plain UTF-16 character-name
// pointer follows the encoded-name pointer and is the same field used by
// PlayerMgr::GetPlayerName(player_number).
const PLAYER_NAME_POINTER: u32 = 0x28;

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut WRITE_COUNT: u32 = 0;
static mut REJECTED_COUNT: u32 = 0;

unsafe fn rendered_units(pointer: u32) -> Option<u32> {
    if pointer == 0 || pointer & 1 != 0 {
        return None;
    }
    let maximum = (6 + WHISPER_SENDER_UNITS + 2 + WHISPER_MESSAGE_UNITS + 1) as u32;
    for index in 0..=maximum {
        let address = indexed(pointer, index, 2)?;
        if unsafe { read_u16(address)? } == 0 {
            return Some(index);
        }
    }
    None
}

// Public player chat is written through the certified "with sender" packet.
// Its sender is an independent encoded string: TEXT_STYLE, SENDER_STYLE, name,
// CONTROL_END, NUL. Accept the shorter SENDER_STYLE form too because the game
// itself can supply already-styled sender text.
unsafe fn encoded_sender(pointer: u32) -> Option<(u32, u32)> {
    if pointer == 0 || pointer & 1 != 0 { return None; }
    let maximum = (WHISPER_SENDER_UNITS + 3) as u32;
    let mut units = None;
    for index in 0..=maximum {
        let address = indexed(pointer, index, 2)?;
        if unsafe { read_u16(address)? } == 0 { units = Some(index); break; }
    }
    let units = units?;
    if units < 3 || unsafe { read_u16(indexed(pointer, units - 1, 2)?) } != Some(CONTROL_END) {
        return None;
    }
    let first = unsafe { read_u16(pointer)? };
    let start = if first == TEXT_STYLE
        && unsafe { read_u16(indexed(pointer, 1, 2)?) } == Some(SENDER_STYLE) { 2 }
        else if first == SENDER_STYLE { 1 }
        else { return None; };
    let name_units = units.checked_sub(start + 1)?;
    if name_units == 0 || name_units > WHISPER_SENDER_UNITS as u32 { return None; }
    Some((start, name_units))
}

// The outgoing producer encodes a u32 argument before its two string arguments.
// Numeric digits use base 0x7f00, with bit 15 marking continuation; the final
// digit has no end marker. Incoming whispers start directly with SENDER_STYLE.
unsafe fn sender_start(pointer: u32, outgoing: bool) -> Option<u32> {
    if !outgoing { return Some(2); }
    if unsafe { read_u16(indexed(pointer, 1, 2)?) } != Some(0x0101) { return None; }
    let mut value = 0u32;
    for index in 2..5 {
        let unit = unsafe { read_u16(indexed(pointer, index, 2)?)? };
        let digit = (unit & 0x7fff).checked_sub(0x0100)? as u32;
        value = value.checked_mul(0x7f00)?.checked_add(digit)?;
        if unit & 0x8000 == 0 { return Some(index + 2); }
    }
    None
}

unsafe fn parse(pointer: u32, outgoing: bool) -> Option<(u32, u32, u32, u32)> {
    let units = unsafe { rendered_units(pointer)? };
    let sender_start = unsafe { sender_start(pointer, outgoing)? };
    if units < sender_start + 5
        || unsafe { read_u16(indexed(pointer, sender_start - 1, 2)?) } != Some(SENDER_STYLE)
        || unsafe { read_u16(indexed(pointer, units - 1, 2)?) } != Some(CONTROL_END)
    {
        return None;
    }
    let maximum_separator = sender_start + WHISPER_SENDER_UNITS as u32;
    for separator in sender_start + 1..=maximum_separator.min(units.saturating_sub(4)) {
        if unsafe { read_u16(indexed(pointer, separator, 2)?) } == Some(CONTROL_END)
            && unsafe { read_u16(indexed(pointer, separator + 1, 2)?) } == Some(TEXT_STYLE)
        {
            let sender_units = separator - sender_start;
            let message_start = separator + 2;
            let message_units = units - message_start - 1;
            if message_units == 0 || message_units > WHISPER_MESSAGE_UNITS as u32 { return None; }
            return Some((sender_start, sender_units, message_start, message_units));
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

unsafe fn player_name(layout: Layout, game: u32, player_number: u32) -> Option<(u32, u32)> {
    if player_number == 0
        || layout.world_context == 0
        || layout.world_players == 0
        || layout.player_record_stride < 0x50
        || layout.player_record_stride > 256
        || layout.player_record_number + 4 > layout.player_record_stride
        || PLAYER_NAME_POINTER + 4 > layout.player_record_stride
    {
        return None;
    }
    let world_required = layout.world_players.checked_add(12)?;
    let world = offset(game, layout.world_context)
        .and_then(|at| unsafe { pointer(at, world_required) })?;
    let players = offset(world, layout.world_players)?;
    let buffer = unsafe { read_u32(players) }?;
    let capacity = unsafe { read_u32(offset(players, 4)?) }?;
    let size = unsafe { read_u32(offset(players, 8)?) }?;
    if size == 0 || size > capacity || player_number >= size || capacity > 2_048
        || buffer == 0 || buffer & 3 != 0
        || !contains(buffer, checked_mul(capacity, layout.player_record_stride)?)
    {
        return None;
    }
    let record = indexed(buffer, player_number, layout.player_record_stride)?;
    if unsafe { read_u32(offset(record, layout.player_record_number)?) } != Some(player_number) {
        return None;
    }
    let name = unsafe { read_u32(offset(record, PLAYER_NAME_POINTER)?) }?;
    if name == 0 || name & 1 != 0 { return None; }
    for units in 1..=WHISPER_SENDER_UNITS as u32 {
        if unsafe { read_u16(indexed(name, units, 2)?) } == Some(0) {
            return unsafe { valid_utf16(name, 0, units) }.then_some((name, units));
        }
    }
    None
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

unsafe fn append(
    text: u32,
    sender_start: u32,
    sender_units: u32,
    message_start: u32,
    message_units: u32,
    outgoing: bool,
    participant: bool,
) {
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
            sender_units
                | if participant { 1 << 30 } else { message_units << 16 }
                | if outgoing { 1 << 31 } else { 0 },
        );
        for index in 0..WHISPER_SENDER_UNITS {
            let value = if index < sender_units as usize {
                read_u16(indexed(text, index as u32 + sender_start, 2).unwrap_or(0)).unwrap_or(0)
            } else {
                0
            };
            write_volatile(&mut slot.sender[index], value);
        }
        for index in 0..WHISPER_MESSAGE_UNITS {
            let value = if !participant && index < message_units as usize {
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

pub(crate) unsafe fn observe(layout: Layout, game: u32, message: u32, wparam: u32) {
    if !matches!(message, 0x1000_007f | 0x1000_0080 | 0x1000_0082)
        || wparam == 0 || wparam & 3 != 0 || !contains(wparam, 8) {
        return;
    }
    let channel = unsafe { read_u32(wparam) };
    let participant = matches!(channel,
        Some(ALLIANCE_CHANNEL) | Some(ALLIES_CHANNEL) | Some(ALL_CHANNEL)
            | Some(GUILD_CHANNEL) | Some(GROUP_CHANNEL) | Some(TRADE_CHANNEL));
    if channel != Some(INCOMING_WHISPER_CHANNEL) && channel != Some(GLOBAL_CHANNEL) && !participant {
        return;
    }
    if message == 0x1000_0082 {
        if !participant || !contains(wparam, 12) { return; }
        let Some((name, name_units)) = offset(wparam, 8)
            .and_then(|at| unsafe { read_u32(at) })
            .and_then(|player_number| unsafe { player_name(layout, game, player_number) })
        else { return; };
        unsafe { append(name, 0, name_units, 0, 0, false, true) };
        return;
    }
    if message == 0x1000_0080 {
        if !participant || !contains(wparam, 12) { return; }
        let sender = offset(wparam, 8).and_then(|at| unsafe { read_u32(at) });
        let Some((sender, (sender_start, sender_units))) = sender
            .and_then(|sender| unsafe { encoded_sender(sender) }.map(|shape| (sender, shape)))
        else { return; };
        if !unsafe { valid_utf16(sender, sender_start, sender_units) } { return; }
        unsafe { append(sender, sender_start, sender_units, 0, 0, false, true) };
        return;
    }
    let text = offset(wparam, 4).and_then(|at| unsafe { read_u32(at) });
    let outgoing = channel == Some(GLOBAL_CHANNEL);
    if outgoing && text.and_then(|p| unsafe { read_u16(p) }) != Some(OUTGOING_TEMPLATE) {
        return;
    }
    let Some((text, (sender_start, sender_units, message_start, message_units))) =
        text.and_then(|text| unsafe { parse(text, outgoing) }.map(|shape| (text, shape)))
    else {
        if !participant { unsafe { reject() }; }
        return;
    };
    if !unsafe { valid_utf16(text, sender_start, sender_units) }
        || (!participant && !unsafe { valid_utf16(text, message_start, message_units) }) {
        if !participant { unsafe { reject() }; }
        return;
    }
    unsafe { append(text, sender_start, sender_units, message_start, message_units, outgoing, participant) };
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
