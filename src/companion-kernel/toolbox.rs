use core::ptr::{read_volatile, write_volatile};

use crate::abi::*;
use crate::{collect_first_owned_hero, cursor, resolve_game, GameState};

// UI dispatch is the certified change boundary for this first foundation.
// A low-rate reconciliation recovers from a missed callback without turning
// the hero observer back into a per-frame party walk.
const RECONCILE_TICKS: u32 = 120;

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut PLAYER_CHAT_COUNT: u32 = 0;
static mut HERO_COUNT: u32 = 0;
static mut FIRST_HERO_ID: u32 = 0;
static mut FIRST_HERO_AGENT_ID: u32 = 0;
static mut PANEL_STATE: u32 = PANEL_UNKNOWN;
static mut PARTY_DIRTY: bool = true;

fn is_party_dirty_message(layout: Layout, message: u32) -> bool {
    let dirty = layout.party_dirty_messages;
    message == dirty[0]
        || message == dirty[1]
        || message == dirty[2]
        || message == dirty[3]
        || message == dirty[4]
        || message == dirty[5]
        || message == dirty[6]
        || message == dirty[7]
        || message == dirty[8]
        || message == dirty[9]
}

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
        PARTY_DIRTY = true;
    }
    for index in 0..TOOLBOX_BYTES / 4 {
        unsafe { write_volatile((pointer + index * 4) as *mut u32, 0) };
    }
    unsafe { publish() };
}

unsafe fn apply_hero_state(count: u32, hero_id: u32, agent_id: u32) {
    let panel_state = if unsafe { FIRST_HERO_ID } == hero_id {
        unsafe { PANEL_STATE }
    } else {
        PANEL_UNKNOWN
    };
    if unsafe {
        HERO_COUNT == count
            && FIRST_HERO_ID == hero_id
            && FIRST_HERO_AGENT_ID == agent_id
            && PANEL_STATE == panel_state
    } {
        return;
    }
    unsafe {
        HERO_COUNT = count;
        FIRST_HERO_ID = hero_id;
        FIRST_HERO_AGENT_ID = agent_id;
        PANEL_STATE = panel_state;
        publish();
    }
}

pub(crate) unsafe fn tick(layout: Layout, tick_count: u32) {
    if !unsafe { PARTY_DIRTY } && tick_count.wrapping_sub(1) % RECONCILE_TICKS != 0 {
        return;
    }
    unsafe { PARTY_DIRTY = false };
    let state = match unsafe { resolve_game(layout) } {
        GameState::Ready {
            game,
            player_number,
            ..
        } => unsafe { collect_first_owned_hero(layout, game, player_number) },
        GameState::Loading | GameState::Unavailable => (0, 0, 0),
    };
    unsafe { apply_hero_state(state.0, state.1, state.2) };
}

pub(crate) unsafe fn observe_ui(layout: Layout, message: u32, wparam: u32) {
    unsafe {
        // The exact build supplies the closed party/hero/map lifecycle set.
        // Rust deliberately knows only the configured values, not global GWCA
        // message constants, so unrelated central UI traffic cannot schedule a
        // party traversal.
        if is_party_dirty_message(layout, message) {
            PARTY_DIRTY = true;
        }
        if message == layout.player_chat_message {
            let next = PLAYER_CHAT_COUNT.saturating_add(1);
            if next != PLAYER_CHAT_COUNT {
                PLAYER_CHAT_COUNT = next;
                publish();
            }
        } else if FIRST_HERO_ID != 0
            && wparam == FIRST_HERO_ID
            && message == layout.hide_hero_panel_message
            && PANEL_STATE != PANEL_HIDDEN
        {
            PANEL_STATE = PANEL_HIDDEN;
            publish();
        } else if FIRST_HERO_ID != 0
            && wparam == FIRST_HERO_ID
            && message == layout.show_hero_panel_message
            && PANEL_STATE != PANEL_SHOWN
        {
            PANEL_STATE = PANEL_SHOWN;
            publish();
        }
    }
}

pub(crate) unsafe fn publish_cursor_event() {
    let count = unsafe { cursor::event_count() };
    let published =
        unsafe { read_volatile(&(*(POINTER as *const ToolboxSnapshot)).cursor_event_count) };
    if count != published {
        unsafe { publish() };
    }
}
