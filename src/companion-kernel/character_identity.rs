//! Produces the one privacy-safe character key shared by account-list and
//! in-world publications. Raw UUID bytes never leave the kernel.

use crate::memory::{contains, offset, read_u32};

pub(crate) unsafe fn character_key(uuid: u32) -> Option<u64> {
    if uuid == 0 || !contains(uuid, 16) {
        return None;
    }
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut nonzero = 0_u32;
    for index in 0..4_u32 {
        let word = unsafe { read_u32(offset(uuid, index * 4)?)? };
        nonzero |= word;
        for byte in word.to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    }
    (nonzero != 0 && hash != 0).then_some(hash)
}
