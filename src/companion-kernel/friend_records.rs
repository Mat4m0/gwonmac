//! Bounded friend-record decoding for the pending certified observer. This
//! module does not establish session readiness or grant Travel authority.
//! The caller must admit the current session before using these decoded fields.

use crate::memory::{contains, indexed, read_u16, read_u32};

pub(crate) const FRIEND_SLOTS: usize = 128;
pub(crate) const NAME_UNITS: usize = 20;
// These are reader work limits, not claims about the client's roster capacity.
const MAX_TABLE_SLOTS: u32 = 4096;
const RECORD_BYTES: u32 = 172;

#[derive(Clone, Copy)]
#[repr(C)]
pub(crate) struct FriendRecord {
    pub(crate) key_low: u32,
    pub(crate) key_high: u32,
    pub(crate) status: u32,
    pub(crate) map_id: u32,
    pub(crate) alias: [u16; NAME_UNITS],
    pub(crate) character: [u16; NAME_UNITS],
}

#[repr(C)]
pub(crate) struct DecodedFriends {
    pub(crate) count: u32,
    pub(crate) records: [FriendRecord; FRIEND_SLOTS],
}

unsafe fn name(address: u32, allow_empty: bool) -> Option<[u16; NAME_UNITS]> {
    let mut result = [0; NAME_UNITS];
    let mut trailing_surrogate = false;
    for (index, slot) in result.iter_mut().enumerate() {
        let unit = unsafe { read_u16(indexed(address, index as u32, 2)?)? };
        if unit == 0 {
            return ((!trailing_surrogate) && (allow_empty || index != 0)).then_some(result);
        }
        if unit < 0x20 || unit == 0x7f {
            return None;
        }
        if trailing_surrogate {
            if !(0xdc00..=0xdfff).contains(&unit) {
                return None;
            }
            trailing_surrogate = false;
        } else if (0xd800..=0xdbff).contains(&unit) {
            trailing_surrogate = true;
        } else if (0xdc00..=0xdfff).contains(&unit) {
            return None;
        }
        *slot = unit;
    }
    None // Native bounded copies reserve a terminating unit.
}

unsafe fn friend_key(uuid: u32, session: u32) -> Option<(u32, u32)> {
    let mut low = 0x811c_9dc5_u32;
    let mut high = 0x9e37_79b9_u32;
    for byte in session.to_le_bytes() {
        low = (low ^ u32::from(byte)).wrapping_mul(0x0100_0193);
        high = high.rotate_left(5) ^ u32::from(byte);
    }
    let mut nonzero = 0;
    for index in 0..4 {
        let word = unsafe { read_u32(indexed(uuid, index, 4)?)? };
        nonzero |= word;
        for byte in word.to_le_bytes() {
            low = (low ^ u32::from(byte)).wrapping_mul(0x0100_0193);
            high = high.rotate_left(5) ^ u32::from(byte);
        }
    }
    (nonzero != 0 && (low != 0 || high != 0)).then_some((low, high))
}

/// Decode the complete bounded table or return unavailable. A decoded empty
/// table is still not proof that the server completed the current login.
///
/// SAFETY: the caller supplies the root only after its layout is certified.
/// Run on the non-reentrant game callback thread. No pointer escapes this function.
pub(crate) unsafe fn read_records(root: u32, session: u32) -> Option<DecodedFriends> {
    if session == 0 || root == 0 || root & 3 != 0 || !contains(root, 12) {
        return None;
    }
    let array = unsafe { read_u32(root)? };
    let capacity = unsafe { read_u32(root + 4)? };
    let count = unsafe { read_u32(root + 8)? };
    if array == 0
        || array & 3 != 0
        || !(1..=MAX_TABLE_SLOTS).contains(&count)
        || capacity < count
        || capacity > u32::MAX / 4
        || !contains(array, capacity * 4)
        || unsafe { read_u32(array)? } != 0
    {
        return None;
    }
    // All-zero is a valid representation; avoid a second static record image.
    let mut result: DecodedFriends = unsafe { core::mem::MaybeUninit::zeroed().assume_init() };
    for slot in 1..count {
        let address = unsafe { read_u32(indexed(array, slot, 4)?)? };
        if address == 0 {
            continue;
        }
        if address & 3 != 0
            || !contains(address, RECORD_BYTES)
            || unsafe { read_u32(address + 104)? } != slot
        {
            return None;
        }
        let category = unsafe { read_u32(address)? };
        if category > 4 {
            return None;
        }
        if category != 1 {
            continue;
        }
        let index = result.count as usize;
        if index == FRIEND_SLOTS {
            return None;
        }
        let status = unsafe { read_u32(address + 4)? };
        if status > 4 {
            return None;
        }
        let key = unsafe { friend_key(address + 8, session)? };
        let mut previous = 0;
        while previous < index {
            let record = unsafe { result.records.get_unchecked(previous) };
            if record.key_low == key.0 && record.key_high == key.1 {
                return None;
            }
            previous += 1;
        }
        *result.records.get_mut(index)? = FriendRecord {
            key_low: key.0,
            key_high: key.1,
            status,
            map_id: unsafe { read_u32(address + 108)? },
            alias: unsafe { name(address + 24, false)? },
            character: unsafe { name(address + 64, true)? },
        };
        result.count += 1;
    }
    if unsafe { read_u32(root)? } != array
        || unsafe { read_u32(root + 4)? } != capacity
        || unsafe { read_u32(root + 8)? } != count
    {
        return None;
    }
    Some(result)
}
