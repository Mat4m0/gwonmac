//! Standalone WASM harness for the pending companion reader, using its real memory helpers.
#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

#[path = "../../src/companion-kernel/friend_records.rs"]
mod friend_records;
#[path = "../../src/companion-kernel/friend_session.rs"]
mod friend_session;
#[path = "../../src/companion-kernel/memory.rs"]
mod memory;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub unsafe extern "C" fn decode(root: u32, session: u32, output: u32) -> u32 {
    if output == 0
        || output & 3 != 0
        || !memory::contains(
            output,
            core::mem::size_of::<friend_records::DecodedFriends>() as u32,
        )
    {
        return 0;
    }
    let decoded = unsafe { friend_records::read_records(root, session) };
    let decoded_ok = u32::from(decoded.is_some());
    let records =
        decoded.unwrap_or_else(|| unsafe { core::mem::MaybeUninit::zeroed().assume_init() });
    unsafe { (output as *mut friend_records::DecodedFriends).write(records) };
    decoded_ok
}

#[no_mangle]
pub unsafe extern "C" fn session_initialize() {
    unsafe { friend_session::initialize() }
}

#[no_mangle]
pub unsafe extern "C" fn session_invalidate() {
    unsafe { friend_session::invalidate() }
}

#[no_mangle]
pub unsafe extern "C" fn session_request_sent(request_id: u32, connection: u32) {
    unsafe { friend_session::request_sent(request_id, connection) }
}

#[no_mangle]
pub unsafe extern "C" fn session_completion_started(
    request_id: u32,
    connection: u32,
    success: u32,
) {
    unsafe { friend_session::completion_started(request_id, connection, success != 0) }
}

#[no_mangle]
pub unsafe extern "C" fn session_completion_queued() {
    unsafe { friend_session::completion_queued() }
}

#[no_mangle]
pub unsafe extern "C" fn session_completion_finished() {
    unsafe { friend_session::completion_finished() }
}

#[no_mangle]
pub unsafe extern "C" fn session_completion_processed() {
    unsafe { friend_session::completion_processed() }
}

#[no_mangle]
pub unsafe extern "C" fn session_generation() -> u32 {
    unsafe { friend_session::accepted_generation() }
}
