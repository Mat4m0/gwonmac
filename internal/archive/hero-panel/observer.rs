//! Archived reference only; this file is not part of the companion crate.

const PANEL_UNKNOWN: u32 = 0;
const PANEL_HIDDEN: u32 = 1;
const PANEL_SHOWN: u32 = 2;

/// Former state transition inside `toolbox::observe_ui`.
fn observe_panel(
    current: u32,
    first_hero_id: u32,
    message: u32,
    wparam: u32,
    hide_message: u32,
    show_message: u32,
) -> u32 {
    if first_hero_id == 0 || wparam != first_hero_id {
        return current;
    }
    if message == hide_message {
        PANEL_HIDDEN
    } else if message == show_message {
        PANEL_SHOWN
    } else {
        current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_first_heroes_exact_messages_change_state() {
        assert_eq!(observe_panel(PANEL_UNKNOWN, 1, 0x1000_01a4, 1,
            0x1000_01a3, 0x1000_01a4), PANEL_SHOWN);
        assert_eq!(observe_panel(PANEL_SHOWN, 1, 0x1000_01a3, 1,
            0x1000_01a3, 0x1000_01a4), PANEL_HIDDEN);
        assert_eq!(observe_panel(PANEL_UNKNOWN, 1, 0x1000_01a4, 2,
            0x1000_01a3, 0x1000_01a4), PANEL_UNKNOWN);
    }
}
