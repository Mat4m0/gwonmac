use core::ptr::{read_volatile, write_volatile};

use crate::abi::*;
use crate::{collect_first_owned_hero, cursor, ui_original, State};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut PLAYER_CHAT_COUNT: u32 = 0;
static mut HERO_COUNT: u32 = 0;
static mut FIRST_HERO_ID: u32 = 0;
static mut FIRST_HERO_AGENT_ID: u32 = 0;
static mut PANEL_STATE: u32 = PANEL_UNKNOWN;
static mut PANEL_PENDING: u32 = PANEL_UNKNOWN;
static mut COMMAND_REQUEST: u32 = 0;
static mut COMMAND_COMPLETE: u32 = 0;
static mut COMMAND_STATUS: u32 = COMMAND_IDLE;

unsafe fn publish() {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { POINTER as *mut ToolboxSnapshot };
    let flags = if unsafe { FIRST_HERO_ID } != 0 {
        FLAG_HERO_AVAILABLE
    } else {
        0
    };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, TOOLBOX_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, TOOLBOX_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, flags);
        write_volatile(&mut (*snapshot).player_chat_count, PLAYER_CHAT_COUNT);
        write_volatile(&mut (*snapshot).cursor_event_count, cursor::event_count());
        write_volatile(&mut (*snapshot).hero_count, HERO_COUNT);
        write_volatile(&mut (*snapshot).first_hero_id, FIRST_HERO_ID);
        write_volatile(&mut (*snapshot).first_hero_agent_id, FIRST_HERO_AGENT_ID);
        write_volatile(&mut (*snapshot).panel_state, PANEL_STATE);
        write_volatile(&mut (*snapshot).command_request, COMMAND_REQUEST);
        write_volatile(&mut (*snapshot).command_complete, COMMAND_COMPLETE);
        write_volatile(&mut (*snapshot).command_status, COMMAND_STATUS);
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe {
        POINTER = pointer;
        SEQUENCE = 0;
        PLAYER_CHAT_COUNT = 0;
        HERO_COUNT = 0;
        FIRST_HERO_ID = 0;
        FIRST_HERO_AGENT_ID = 0;
        PANEL_STATE = PANEL_UNKNOWN;
        PANEL_PENDING = PANEL_UNKNOWN;
        COMMAND_REQUEST = 0;
        COMMAND_COMPLETE = 0;
        COMMAND_STATUS = COMMAND_IDLE;
    }
    for index in 0..TOOLBOX_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish() };
}

pub(crate) unsafe fn tick(layout: Layout, state: State) {
    let (count, hero_id, agent_id) = unsafe { collect_first_owned_hero(layout, state) };
    unsafe {
        if FIRST_HERO_ID != hero_id {
            PANEL_STATE = PANEL_UNKNOWN;
        }
        HERO_COUNT = count;
        FIRST_HERO_ID = hero_id;
        FIRST_HERO_AGENT_ID = agent_id;
    }
    unsafe { apply_pending_hero_command(layout, state) };
    unsafe { publish() };
}

// Internal calls made after the game tick need the same PropContext that the
// official browser client installs around its own calls. Save the slot, install
// the already-validated GameContext for this one synchronous dispatch, and
// restore the exact prior value before publishing completion.
unsafe fn apply_pending_hero_command(layout: Layout, state: State) {
    let desired = unsafe { PANEL_PENDING };
    if desired == PANEL_UNKNOWN {
        return;
    }
    unsafe { PANEL_PENDING = PANEL_UNKNOWN };
    let hero_id = unsafe { FIRST_HERO_ID };
    if hero_id == 0 || state.game == 0 {
        unsafe {
            COMMAND_COMPLETE = COMMAND_REQUEST;
            COMMAND_STATUS = COMMAND_UNAVAILABLE;
        }
        return;
    }
    let message = if desired == PANEL_SHOWN {
        layout.show_hero_panel_message
    } else {
        layout.hide_hero_panel_message
    };
    let previous = unsafe { read_volatile(layout.prop_context_slot as *const u32) };
    unsafe {
        write_volatile(layout.prop_context_slot as *mut u32, state.game);
        ui_original(message, hero_id, 0);
        write_volatile(layout.prop_context_slot as *mut u32, previous);
    }
    unsafe {
        PANEL_STATE = desired;
        COMMAND_COMPLETE = COMMAND_REQUEST;
        COMMAND_STATUS = COMMAND_APPLIED;
    }
}

pub(crate) unsafe fn observe_ui(layout: Layout, message: u32, wparam: u32) {
    unsafe {
        if message == layout.player_chat_message {
            PLAYER_CHAT_COUNT = PLAYER_CHAT_COUNT.saturating_add(1);
        } else if wparam == FIRST_HERO_ID && message == layout.hide_hero_panel_message {
            PANEL_STATE = PANEL_HIDDEN;
        } else if wparam == FIRST_HERO_ID && message == layout.show_hero_panel_message {
            PANEL_STATE = PANEL_SHOWN;
        }
        publish();
    }
}

pub(crate) unsafe fn publish_cursor_event() {
    unsafe { publish() };
}

pub(crate) unsafe fn request_first_hero_panel(shown: u32) -> u32 {
    if shown > 1 || unsafe { PANEL_PENDING } != PANEL_UNKNOWN {
        return 0;
    }
    let mut request = unsafe { COMMAND_REQUEST }.wrapping_add(1);
    if request == 0 {
        request = 1;
    }
    unsafe {
        COMMAND_REQUEST = request;
        COMMAND_STATUS = COMMAND_IDLE;
        PANEL_PENDING = if shown == 1 {
            PANEL_SHOWN
        } else {
            PANEL_HIDDEN
        };
        publish();
    }
    request
}
