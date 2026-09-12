//! Observes the certified post-processing notification without modifying it.
//! The countdown is an estimate corrected by every native alcohol-level update.
//! Character identity owns continuity across zoning; no state survives logout.
use core::ptr::write_volatile;
use crate::abi::*;
use crate::memory::*;
use crate::{resolve_game, GameState};
use crate::play_region::current_character_key;

static mut POINTER: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut CLOCK: u32 = 0;
static mut CHARACTER: u64 = 0;
static mut LEVEL: u32 = 0;
static mut DEADLINE: u32 = 0;
static mut KNOWN: bool = false;
static mut PREVIOUS_BRANDY: u32 = 0;
const POST_PROCESS: u32 = 0x1000_0034;

unsafe fn reset() {
    unsafe { LEVEL = 0; DEADLINE = 0; KNOWN = false; PREVIOUS_BRANDY = 0; CHARACTER = 0; }
}
unsafe fn publish(ready: bool) {
    unsafe {
        SEQUENCE = SEQUENCE.wrapping_add(2) & !1;
        let remaining = DEADLINE.wrapping_sub(CLOCK);
        let remaining = if ready && remaining <= 300_000 { remaining } else { 0 };
        let values = [0x414c_5747, (ALCOHOL_BYTES << 16) | 1, SEQUENCE - 1,
            u32::from(ready), CLOCK, remaining, CHARACTER as u32, (CHARACTER >> 32) as u32];
        for (index, value) in values.iter().enumerate() {
            write_volatile((POINTER + index as u32 * 4) as *mut u32, *value);
        }
        write_volatile((POINTER + 8) as *mut u32, SEQUENCE);
    }
}
pub(crate) unsafe fn initialize(pointer: u32) {
    unsafe { POINTER = pointer; SEQUENCE = 0; CLOCK = 0; reset(); publish(false); }
}
pub(crate) unsafe fn tick(layout: Layout, clock: u32, enabled: bool) {
    unsafe {
        CLOCK = clock;
        if !enabled { reset(); publish(false); return; }
        match resolve_game(layout) {
            GameState::Ready { game, play_region: PLAY_REGION_PVE, .. } => {
                let key = current_character_key(layout, game).unwrap_or(0);
                if key == 0 || key != CHARACTER { reset(); CHARACTER = key; }
                publish(KNOWN && key != 0);
            }
            GameState::Loading => publish(false),
            _ => { reset(); publish(false); }
        }
    }
}
pub(crate) unsafe fn observe(layout: Layout, message: u32, payload: u32) {
    if message != POST_PROCESS || payload & 3 != 0 || !contains(payload, 8) { return; }
    unsafe {
        let GameState::Ready { game, play_region: PLAY_REGION_PVE, .. } = resolve_game(layout) else { return; };
        let Some(key) = current_character_key(layout, game) else { return; };
        if key == 0 { return; }
        if key != CHARACTER { reset(); CHARACTER = key; }
        let Some(tint) = read_u32(payload) else { return; };
        let Some(amount) = read_f32(payload + 4) else { return; };
        if !amount.is_finite() || !(0.0..=1.0).contains(&amount) || tint > 8 { return; }
        let scaled = amount * 5.0;
        let level = (scaled + 0.5) as u32;
        if (scaled - level as f32).abs() > 0.001 { return; }
        // Toolbox's shared post-process cases: salad is not alcohol; a lunar
        // jumps directly to tint 6/level 5, whereas brandy traverses the levels.
        if tint == 8 && level == 5 { return; }
        if tint == 6 {
            let previous = PREVIOUS_BRANDY;
            PREVIOUS_BRANDY = level;
            if level == 5 && previous != 4 { return; }
        }
        let old_remaining = DEADLINE.wrapping_sub(CLOCK);
        let old_remaining = if KNOWN && old_remaining <= 300_000 { old_remaining } else { 0 };
        let remaining = if level > LEVEL && old_remaining > 0 {
            old_remaining.saturating_add((level - LEVEL) * 60_000).min(300_000)
        } else { level * 60_000 };
        LEVEL = level;
        DEADLINE = CLOCK.wrapping_add(remaining);
        KNOWN = true;
        publish(true);
    }
}
