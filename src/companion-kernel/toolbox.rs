use core::ptr::write_volatile;

use crate::abi::*;
use crate::{collect_first_owned_hero, cursor, State};

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut PLAYER_CHAT_COUNT: u32 = 0;
static mut HERO_COUNT: u32 = 0;
static mut FIRST_HERO_ID: u32 = 0;
static mut FIRST_HERO_AGENT_ID: u32 = 0;
static mut PANEL_STATE: u32 = PANEL_UNKNOWN;

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
    unsafe { publish() };
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
