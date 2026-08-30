//! Fixed, read-only account-character publication. The exact-build roots come
//! from the certified config; no pointer or raw record crosses this boundary.

use core::ptr::write_volatile;
use core::mem::MaybeUninit;

use crate::abi::*;
use crate::character_identity::character_key;
use crate::memory::*;

const RECORD_BYTES: u32 = 0x84;
const SUMMARY_LENGTH: u32 = 0x04;
const NAME_OFFSET: u32 = 0x18;
const UUID_OFFSET: u32 = 0x08;
const SUMMARY_OFFSET: u32 = 0x40;
const MAX_SUMMARY_BYTES: u32 = 0x40;
const MAX_MAP_ID: u32 = 882;
const SUMMARY_FORMAT: u16 = 8;

static mut SNAPSHOT_PTR: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut ROOT_POINTER: u32 = 0;
static mut ROOT_COUNT: u32 = 0;
static mut STABLE_READS: u32 = 0;

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        SNAPSHOT_PTR = pointer;
        SEQUENCE = 0;
        ROOT_POINTER = 0;
        ROOT_COUNT = 0;
        STABLE_READS = 0;
        let empty: [CharacterRecord; CHARACTER_SLOTS] = MaybeUninit::zeroed().assume_init();
        publish(FLAG_CHARACTER_LIST_ABSENT, 0, u32::MAX, &empty);
    }
}

unsafe fn read_name(address: u32, allow_empty: bool) -> Option<[u16; CHARACTER_NAME_UNITS]> {
    let mut name = [0_u16; CHARACTER_NAME_UNITS];
    let mut length = None;
    for (index, slot) in name.iter_mut().enumerate() {
        let unit = unsafe { read_u16(checked_add(address, (index as u32) * 2)?)? };
        *slot = unit;
        if unit == 0 {
            length = Some(index);
            break;
        }
    }
    let length = length?;
    if !allow_empty && length == 0 {
        return None;
    }
    let mut index = 0;
    while index < length {
        let unit = *name.get(index)?;
        if (0xd800..=0xdbff).contains(&unit) {
            index += 1;
            if index >= length || !(0xdc00..=0xdfff).contains(name.get(index)?) {
                return None;
            }
        } else if (0xdc00..=0xdfff).contains(&unit) {
            return None;
        }
        index += 1;
    }
    Some(name)
}

fn names_equal(left: &[u16; CHARACTER_NAME_UNITS], right: &[u16; CHARACTER_NAME_UNITS]) -> bool {
    left == right
}

unsafe fn publish(
    flags: u32,
    count: u32,
    selected_index: u32,
    records: &[CharacterRecord; CHARACTER_SLOTS],
) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { SNAPSHOT_PTR as *mut CharacterListSnapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, CHARACTER_LIST_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, CHARACTER_LIST_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, flags);
        write_volatile(&mut (*snapshot).count, count);
        write_volatile(&mut (*snapshot).selected_index, selected_index);
        let output = core::ptr::addr_of_mut!((*snapshot).records).cast::<CharacterRecord>();
        for (index, record) in records.iter().enumerate() {
            write_volatile(output.add(index), *record);
        }
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn tick(layout: Layout) {
    // All-zero is a valid `CharacterRecord` bit pattern; this avoids embedding
    // a second 3.8-KiB record image in the side module's static footprint.
    let empty: [CharacterRecord; CHARACTER_SLOTS] = unsafe {
        MaybeUninit::zeroed().assume_init()
    };
    let Some(pointer) = (unsafe { read_u32(layout.character_array_pointer) }) else {
        unsafe { publish(0, 0, u32::MAX, &empty) };
        return;
    };
    let Some(count) = (unsafe { read_u32(layout.character_array_count) }) else {
        unsafe { publish(0, 0, u32::MAX, &empty) };
        return;
    };
    if pointer == 0 && count == 0 {
        unsafe {
            ROOT_POINTER = 0;
            ROOT_COUNT = 0;
            STABLE_READS = STABLE_READS.saturating_add(1);
            publish(FLAG_CHARACTER_LIST_ABSENT, 0, u32::MAX, &empty);
        }
        return;
    }
    if count == 0 || count as usize > CHARACTER_SLOTS || pointer == 0 || pointer & 3 != 0
        || !contains(pointer, count.saturating_mul(RECORD_BYTES))
    {
        unsafe { STABLE_READS = 0; publish(0, 0, u32::MAX, &empty) };
        return;
    }
    unsafe {
        if ROOT_POINTER == pointer && ROOT_COUNT == count {
            STABLE_READS = STABLE_READS.saturating_add(1);
        } else {
            ROOT_POINTER = pointer;
            ROOT_COUNT = count;
            STABLE_READS = 1;
        }
    }

    let mut records: [CharacterRecord; CHARACTER_SLOTS] = unsafe {
        MaybeUninit::zeroed().assume_init()
    };
    for index in 0..count as usize {
        let Some(record) = indexed(pointer, index as u32, RECORD_BYTES) else {
            unsafe { STABLE_READS = 0; publish(0, 0, u32::MAX, &empty) };
            return;
        };
        let Some(summary_bytes) = (unsafe { read_u32(record + SUMMARY_LENGTH) }) else {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        };
        if !(33..=MAX_SUMMARY_BYTES).contains(&summary_bytes) {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        }
        let Some(name) = (unsafe { read_name(record + NAME_OFFSET, false) }) else {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        };
        let Some(key) = (unsafe { character_key(record + UUID_OFFSET) }) else {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        };
        if records.iter().take(index).any(|other| names_equal(&other.name, &name)) {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        }
        let summary = record + SUMMARY_OFFSET;
        let Some(format) = (unsafe { read_u16(summary) }) else { return };
        let Some(map_id) = (unsafe { read_u16(summary + 2) }) else { return };
        let Some(appearance) = (unsafe { read_u32(summary + 8) }) else { return };
        let Some(packed) = (unsafe { read_u16(summary + 28) }) else { return };
        let primary_profession = (appearance >> 20) & 0xf;
        let secondary_profession = u32::from((packed >> 10) & 0xf);
        let campaign = u32::from(packed & 0xf);
        let level = u32::from((packed >> 4) & 0x1f);
        let character_type = u32::from((packed >> 9) & 1);
        if format != SUMMARY_FORMAT || !(1..=10).contains(&primary_profession)
            || secondary_profession > 10
            || campaign > 5 || !(1..=20).contains(&level)
            || u32::from(map_id) > MAX_MAP_ID || (character_type == 0 && campaign == 0)
        {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        }
        if records.iter().take(index).any(|other| {
            (u64::from(other.character_key_low)
                | (u64::from(other.character_key_high) << 32)) == key
        }) {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        }
        let Some(slot) = records.get_mut(index) else { return };
        *slot = CharacterRecord {
            name,
            primary_profession,
            secondary_profession,
            character_type,
            campaign,
            level,
            map_id: u32::from(map_id),
            character_key_low: key as u32,
            character_key_high: (key >> 32) as u32,
        };
    }
    if unsafe { read_u32(layout.character_array_pointer) } != Some(pointer)
        || unsafe { read_u32(layout.character_array_count) } != Some(count)
    {
        unsafe { STABLE_READS = 0; publish(0, 0, u32::MAX, &empty) };
        return;
    }
    let Some(selected_name) = (unsafe { read_name(layout.selected_character_name, true) }) else {
        unsafe { publish(0, 0, u32::MAX, &empty) };
        return;
    };
    let selected_index = if selected_name.first() == Some(&0) {
        u32::MAX
    } else {
        let Some(index) = records.iter().take(count as usize)
            .position(|record| names_equal(&record.name, &selected_name))
        else {
            unsafe { publish(0, 0, u32::MAX, &empty) };
            return;
        };
        index as u32
    };
    let flags = if unsafe { STABLE_READS } >= 3 {
        FLAG_CHARACTER_LIST_READY
    } else {
        FLAG_CHARACTER_LIST_WARMING
    };
    unsafe { publish(flags, count, selected_index, &records) };
}
