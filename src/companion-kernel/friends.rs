//! Publishes the current admitted friend roster only while Travel observation
//! is active in a supported region. Lifecycle invalidation clears the owned
//! snapshot synchronously; no native identity or pointer is published.

use core::ptr::{addr_of_mut, write_volatile};
use crate::abi::{Layout, PLAY_REGION_PVE};
use crate::friend_records::{read_records, DecodedFriends, FriendRecord, FRIEND_SLOTS};
use crate::{resolve_game, friend_session, GameState};

pub(crate) const SNAPSHOT_BYTES: u32 = core::mem::size_of::<Snapshot>() as u32;
const MAGIC: u32 = 0x5246_5747;
const ABI_AND_SIZE: u32 = (SNAPSHOT_BYTES << 16) | 1;

#[repr(C)]
struct Snapshot {
    magic: u32,
    abi_and_size: u32,
    sequence: u32,
    ready: u32,
    generation: u32,
    count: u32,
    records: [FriendRecord; FRIEND_SLOTS],
}

const _: [(); 12_312] = [(); core::mem::size_of::<Snapshot>()];
const _: [(); 96] = [(); core::mem::size_of::<FriendRecord>()];

static mut SNAPSHOT_PTR: u32 = 0;
static mut ROOT: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut PUBLISHED: bool = false;

/// SAFETY: initialize receives a validated, exclusively host-owned region.
/// Subsequent calls run on the non-reentrant game callback thread.
pub(crate) unsafe fn initialize(pointer: u32, root: u32) {
    unsafe {
        SNAPSHOT_PTR = pointer;
        ROOT = root;
        SEQUENCE = 0;
        PUBLISHED = false;
        friend_session::initialize();
        publish(0, None);
    }
}

unsafe fn publish(generation: u32, records: Option<&DecodedFriends>) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { SNAPSHOT_PTR as *mut Snapshot };
    // SAFETY: initialize proved the full region; Wasm memory cannot shrink.
    unsafe {
        write_volatile(addr_of_mut!((*snapshot).sequence), next.wrapping_sub(1));
        write_volatile(addr_of_mut!((*snapshot).magic), MAGIC);
        write_volatile(addr_of_mut!((*snapshot).abi_and_size), ABI_AND_SIZE);
        write_volatile(addr_of_mut!((*snapshot).ready), u32::from(records.is_some()));
        write_volatile(addr_of_mut!((*snapshot).generation), generation);
        write_volatile(addr_of_mut!((*snapshot).count), records.map_or(0, |value| value.count));
        let output = addr_of_mut!((*snapshot).records).cast::<FriendRecord>();
        // Clear all slots on withdrawal, including the names no longer in use.
        let empty: FriendRecord = core::mem::MaybeUninit::zeroed().assume_init();
        for index in 0..FRIEND_SLOTS {
            write_volatile(output.add(index), records.map_or(empty, |value| *value.records.get_unchecked(index)));
        }
        write_volatile(addr_of_mut!((*snapshot).sequence), next);
        SEQUENCE = next;
        PUBLISHED = records.is_some();
    }
}

pub(crate) unsafe fn withdraw() {
    if unsafe { PUBLISHED } {
        unsafe { publish(0, None) };
    }
}

pub(crate) unsafe fn lifecycle(event: u32, request: u32, connection: u32, success: u32) {
    unsafe {
        match event {
            1 => friend_session::invalidate(),
            2 => friend_session::request_sent(request, connection),
            3 => friend_session::completion_started(request, connection, success == 1),
            4 => friend_session::completion_queued(),
            5 => friend_session::completion_finished(),
            6 => friend_session::completion_processed(),
            _ => return,
        }
        if friend_session::accepted_generation() == 0 {
            withdraw();
        }
    }
}

pub(crate) unsafe fn tick(layout: Layout) {
    let generation = unsafe { friend_session::accepted_generation() };
    // This lightweight region proof must precede every roster read. Guild halls
    // and PvP outposts classify as PVE here; active PvP and loading do not.
    if generation == 0 || !matches!(unsafe { resolve_game(layout) },
        GameState::Ready { play_region: PLAY_REGION_PVE, .. })
    {
        unsafe { withdraw() };
        return;
    }
    match unsafe { read_records(ROOT, generation) } {
        Some(records) => unsafe { publish(generation, Some(&records)) },
        None => unsafe { withdraw() },
    }
}
