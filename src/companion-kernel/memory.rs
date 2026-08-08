//! The one place this crate turns a game address into a load. Everything the
//! kernel learns about the game heap arrives through these readers.
//!
//! Each reader proves `address .. address + size` lies inside the live linear
//! memory before it loads, and answers `None` when it does not, so a torn or
//! hostile heap costs a frame of observation rather than an out-of-bounds
//! access. Every address is built with checked arithmetic: a sum that would
//! wrap yields `None` instead of a small address that would pass the bounds
//! test. `pointer` also rejects null and unaligned chased values, so a chased
//! base is four-byte-aligned. Nothing here checks the field offsets added to
//! it: natural alignment of the field loads is an assumption the certified
//! build configuration discharges, by supplying real struct offsets that are
//! multiples of the access width.
//!
//! The loads are volatile because the game writes these locations between
//! callbacks and the compiler is told about neither the writer nor the memory;
//! a cached or hoisted load would republish a stale frame.
//!
//! SAFETY: each reader dereferences an address in the imported game memory,
//! which the Rust abstract machine does not know is an allocation. That is the
//! whole of what makes them `unsafe`, and `contains` discharges it in every
//! one, so the pattern is not annotated again below.

use core::ptr::read_volatile;

pub(crate) fn memory_bytes() -> u32 {
    core::arch::wasm32::memory_size(0)
        .saturating_mul(65_536)
        .min(u32::MAX as usize) as u32
}

pub(crate) fn checked_add(left: u32, right: u32) -> Option<u32> {
    left.checked_add(right)
}

pub(crate) fn checked_mul(left: u32, right: u32) -> Option<u32> {
    left.checked_mul(right)
}

pub(crate) fn offset(base: u32, field: u32) -> Option<u32> {
    checked_add(base, field)
}

pub(crate) fn indexed(base: u32, index: u32, stride: u32) -> Option<u32> {
    checked_add(base, checked_mul(index, stride)?)
}

pub(crate) fn contains(address: u32, bytes: u32) -> bool {
    checked_add(address, bytes).is_some_and(|end| end <= memory_bytes())
}

pub(crate) fn valid_region(enabled: bool, address: u32, bytes: u32, expected: u32) -> bool {
    if enabled {
        address != 0 && bytes == expected && address & 3 == 0 && contains(address, bytes)
    } else {
        address == 0 && bytes == 0
    }
}

pub(crate) unsafe fn read_u32(address: u32) -> Option<u32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const u32) })
}

pub(crate) unsafe fn read_i32(address: u32) -> Option<i32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const i32) })
}

pub(crate) unsafe fn read_u16(address: u32) -> Option<u16> {
    contains(address, 2).then(|| unsafe { read_volatile(address as *const u16) })
}

pub(crate) unsafe fn read_u8(address: u32) -> Option<u8> {
    contains(address, 1).then(|| unsafe { read_volatile(address as *const u8) })
}

pub(crate) unsafe fn read_f32(address: u32) -> Option<f32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const f32) })
}

pub(crate) unsafe fn pointer(address: u32, required_bytes: u32) -> Option<u32> {
    let value = unsafe { read_u32(address)? };
    (value != 0 && value & 3 == 0 && contains(value, required_bytes)).then_some(value)
}
