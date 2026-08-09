//! The companion kernel: the freestanding side module the renderer installs on
//! the game's dispatch table. This file owns the exported ABI, the module's
//! state, and the per-frame agent, target, and party observation. `memory.rs`
//! owns every load from a game address, `abi.rs` the shared wire format, and
//! `cursor.rs` and `toolbox.rs` each own the region they publish.
//!
//! The memory-safety invariant the whole crate maintains: the kernel reads the
//! game heap only through `memory.rs`, so every read is bounds-checked against
//! the live linear memory and every pointer chase answers `Option`; a game
//! structure that is missing, torn, or hostile costs an observation and never
//! an out-of-bounds access. The kernel writes to no address the game owns: its
//! only stores go to the snapshot, cursor, and toolbox regions the host set
//! aside for it and `companion_init` accepted through `valid_region`, and to
//! its own module footprint. WebAssembly memory grows and never shrinks, so a
//! region proven in bounds at init stays in bounds for every later frame, which
//! is what lets the publishers hold a raw pointer across callbacks.
//!
//! The module state below is `static mut`, and stays so. The kernel imports no
//! function at all — the build contract admits only memory, the base and stack
//! globals, and a table — so nothing it calls can re-enter it, and it runs only
//! on the game's callback thread. Every access is a by-value load or store of a
//! `Copy` value; the crate never forms a reference to one, so there is no
//! aliasing for a safe wrapper to rule out. A cell wrapper would need its own
//! `unsafe impl Sync`, which claims more than these two facts prove.
//!
//! SAFETY policy for the crate. Two patterns repeat and carry no per-site
//! comment: reading or writing one of these statics, justified above; and
//! calling a `memory.rs` reader, or an `unsafe fn` here that does nothing but
//! forward to them, justified by that module. In `cursor.rs` and `toolbox.rs`,
//! an `unsafe fn` that reaches the module's published region additionally
//! requires that its own `initialize` has run; each module header names the
//! fns that carry no such precondition. Every other unsafe operation states its
//! own justification.

#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

use core::panic::PanicInfo;
use core::ptr::{read_volatile, write_volatile};

mod abi;
mod cursor;
mod memory;
mod party;
mod toolbox;

use abi::*;
use memory::*;

static mut SNAPSHOT_PTR: u32 = 0;
static mut LAYOUT: Layout = Layout::EMPTY;
static mut INITIALIZED: bool = false;
static mut FEATURES: u32 = 0;
static mut ACTIVE_FEATURES: u32 = 0;
static mut TICK_COUNT: u32 = 0;
static mut SEQUENCE: u32 = 0;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    // A panic on the game callback stack must terminate as a bounded trap.
    // Spinning here would freeze the renderer and turn a diagnosable callback
    // failure into an unbounded hang.
    core::arch::wasm32::unreachable()
}

fn finite_position(value: f32) -> bool {
    value.is_finite() && value.abs() <= 1_000_000.0
}

fn valid_agent_type(value: u32) -> bool {
    value & (0x400 | 0x200 | 0xdb) != 0
}

fn valid_toolbox_messages(layout: Layout) -> bool {
    if layout.player_chat_message == 0
        || layout.hide_hero_panel_message == 0
        || layout.show_hero_panel_message == 0
        || layout.player_chat_message == layout.hide_hero_panel_message
        || layout.player_chat_message == layout.show_hero_panel_message
        || layout.hide_hero_panel_message == layout.show_hero_panel_message
    {
        return false;
    }
    for (index, message) in layout.party_dirty_messages.iter().enumerate() {
        if *message == 0
            || *message == layout.player_chat_message
            || *message == layout.hide_hero_panel_message
            || *message == layout.show_hero_panel_message
            || layout.party_dirty_messages[..index].contains(message)
        {
            return false;
        }
    }
    true
}

fn square_root(value: f32) -> f32 {
    if value <= 0.0 {
        return 0.0;
    }
    let mut estimate = f32::from_bits((value.to_bits() >> 1) + 0x1fc0_0000);
    for _ in 0..5 {
        estimate = 0.5 * (estimate + value / estimate);
    }
    estimate
}

fn range_band(distance_squared: f32) -> u32 {
    const RANGES: [f32; 7] = [
        166.0 * 166.0,
        252.0 * 252.0,
        322.0 * 322.0,
        1_012.0 * 1_012.0,
        1_248.0 * 1_248.0,
        2_500.0 * 2_500.0,
        5_000.0 * 5_000.0,
    ];
    RANGES
        .iter()
        .position(|limit| distance_squared <= *limit)
        .map_or(8, |index| index as u32 + 1)
}

#[derive(Clone, Copy)]
struct AgentState {
    id: u32,
    kind: u32,
    x: f32,
    y: f32,
}

#[derive(Clone, Copy)]
struct State {
    flags: u32,
    map_id: u32,
    instance_type: u32,
    play_region: u32,
    player: AgentState,
    target: AgentState,
    distance: f32,
    band: u32,
}

#[derive(Clone, Copy)]
pub(crate) enum GameState {
    Unavailable,
    Loading,
    Ready {
        game: u32,
        map_id: u32,
        instance_type: u32,
        player_number: u32,
        play_region: u32,
    },
}

impl State {
    const fn empty() -> Self {
        const EMPTY_AGENT: AgentState = AgentState {
            id: 0,
            kind: 0,
            x: 0.0,
            y: 0.0,
        };
        Self {
            flags: 0,
            map_id: 0,
            instance_type: 0,
            play_region: PLAY_REGION_UNKNOWN,
            player: EMPTY_AGENT,
            target: EMPTY_AGENT,
            distance: 0.0,
            band: 0,
        }
    }
}

/** The client-owned map policy used by GWToolbox++ itself. */
unsafe fn classify_play_region(layout: Layout, map_id: u32) -> u32 {
    if layout.area_info == 0
        || layout.area_info_count == 0
        || layout.area_info_stride < 20
        || layout.area_info_flags + 4 > layout.area_info_stride
        || map_id >= layout.area_info_count
    {
        return PLAY_REGION_UNKNOWN;
    }
    let Some(record) = indexed(layout.area_info, map_id, layout.area_info_stride) else {
        return PLAY_REGION_UNKNOWN;
    };
    for (field, maximum) in [0_u32, 4, 8, 12].iter().zip([4_u32, 5, 27, 21].iter()) {
        let Some(value) = offset(record, *field).and_then(|at| unsafe { read_u32(at) }) else {
            return PLAY_REGION_UNKNOWN;
        };
        if value > *maximum {
            return PLAY_REGION_UNKNOWN;
        }
    }
    let Some(flags) = offset(record, layout.area_info_flags).and_then(|at| unsafe { read_u32(at) })
    else {
        return PLAY_REGION_UNKNOWN;
    };
    if flags & (0x0004_0001 | 0x0080_0000) != 0 {
        PLAY_REGION_PVP
    } else {
        PLAY_REGION_PVE
    }
}

unsafe fn read_agent(layout: Layout, agent_buffer: u32, size: u32, id: u32) -> Option<AgentState> {
    if id == 0 || id >= size {
        return None;
    }
    let entry = indexed(agent_buffer, id, 4)?;
    let address = unsafe { pointer(entry, 0x100)? };
    if unsafe { read_u32(offset(address, layout.agent_id)?)? } != id {
        return None;
    }
    let kind = unsafe { read_u32(offset(address, layout.agent_type)?)? };
    let x = unsafe { read_f32(offset(address, layout.agent_x)?)? };
    let y = unsafe { read_f32(offset(address, layout.agent_y)?)? };
    if !valid_agent_type(kind) || !finite_position(x) || !finite_position(y) {
        return None;
    }
    Some(AgentState { id, kind, x, y })
}

/** The current player's live agent, proved by login number and model bits. */
pub(crate) unsafe fn find_player_agent(layout: Layout, player_number: u32) -> Option<u32> {
    if !contains(layout.agent_array, 16) {
        return None;
    }
    let buffer = unsafe { read_u32(layout.agent_array) }?;
    let capacity = unsafe { read_u32(offset(layout.agent_array, 4)?) }?;
    let size = unsafe { read_u32(offset(layout.agent_array, 8)?) }?;
    if size == 0 || size > capacity || capacity > 4_096 || !contains(buffer, checked_mul(size, 4)?)
    {
        return None;
    }
    let required = checked_add(layout.agent_model_type, 2)?;
    for id in 1..size {
        let address = indexed(buffer, id, 4).and_then(|at| unsafe { pointer(at, required) });
        let Some(address) = address else { continue };
        if unsafe { read_u32(offset(address, layout.agent_id)?) } == Some(id)
            && unsafe { read_u16(offset(address, layout.agent_player_number)?) }
                == Some(player_number as u16)
            && unsafe { read_u16(offset(address, layout.agent_model_type)?) }
                .map(|value| value & 0xf000)
                == Some(0x3000)
        {
            return Some(id);
        }
    }
    None
}

pub(crate) unsafe fn resolve_game(layout: Layout) -> GameState {
    let contexts = match unsafe { pointer(layout.context_root, 28) } {
        Some(value) => value,
        None => return GameState::Unavailable,
    };
    let game_slot = match indexed(contexts, layout.game_context_slot, 4) {
        Some(value) => value,
        None => return GameState::Unavailable,
    };
    let game = match unsafe { pointer(game_slot, 0x50) } {
        Some(value) => value,
        None => return GameState::Unavailable,
    };
    let character = match offset(game, layout.character_context)
        .and_then(|address| unsafe { pointer(address, 0x2b0) })
    {
        Some(value) => value,
        None => return GameState::Unavailable,
    };

    let read_character =
        |field| offset(character, field).and_then(|address| unsafe { read_u32(address) });
    let Some(base_map) = read_character(layout.map_id) else {
        return GameState::Unavailable;
    };
    let Some(is_explorable) = read_character(layout.is_explorable) else {
        return GameState::Unavailable;
    };
    let Some(map_id) = read_character(layout.current_map_id) else {
        return GameState::Unavailable;
    };
    let Some(instance_type) = read_character(layout.current_instance_type) else {
        return GameState::Unavailable;
    };
    let Some(player_number) = read_character(layout.player_number) else {
        return GameState::Unavailable;
    };
    if instance_type == 2 {
        return GameState::Loading;
    }
    if map_id == 0
        || map_id > 2_000
        || base_map != map_id
        || instance_type > 1
        || is_explorable != u32::from(instance_type == 1)
        || player_number == 0
        || player_number > u16::MAX as u32
    {
        return GameState::Unavailable;
    }

    GameState::Ready {
        game,
        map_id,
        instance_type,
        player_number,
        play_region: unsafe { classify_play_region(layout, map_id) },
    }
}

unsafe fn collect(layout: Layout, observe_target: bool) -> State {
    let mut state = State::empty();
    let (map_id, instance_type, player_number, play_region) = match unsafe { resolve_game(layout) }
    {
        GameState::Unavailable => return state,
        GameState::Loading => {
            state.flags = FLAG_LOADING;
            return state;
        }
        GameState::Ready {
            map_id,
            instance_type,
            player_number,
            play_region,
            ..
        } => (map_id, instance_type, player_number, play_region),
    };

    if !contains(layout.agent_array, 16) {
        return state;
    }
    let Some(agent_buffer) = (unsafe { read_u32(layout.agent_array) }) else {
        return state;
    };
    let Some(capacity_address) = offset(layout.agent_array, 4) else {
        return state;
    };
    let Some(size_address) = offset(layout.agent_array, 8) else {
        return state;
    };
    let Some(capacity) = (unsafe { read_u32(capacity_address) }) else {
        return state;
    };
    let Some(size) = (unsafe { read_u32(size_address) }) else {
        return state;
    };
    let Some(agent_bytes) = checked_mul(size, 4) else {
        return state;
    };
    if size == 0 || size > capacity || capacity > 4_096 || !contains(agent_buffer, agent_bytes) {
        return state;
    }

    for id in 1..size {
        let Some(entry) = indexed(agent_buffer, id, 4) else {
            return state;
        };
        let Some(agent_address) = (unsafe { pointer(entry, 0x100) }) else {
            continue;
        };
        let Some(id_address) = offset(agent_address, layout.agent_id) else {
            return state;
        };
        let Some(player_number_address) = offset(agent_address, layout.agent_player_number) else {
            return state;
        };
        let Some(model_type_address) = offset(agent_address, layout.agent_model_type) else {
            return state;
        };
        if unsafe { read_u32(id_address) } != Some(id)
            || unsafe { read_u16(player_number_address) } != Some(player_number as u16)
            || unsafe { read_u16(model_type_address) }.map(|value| value & 0xf000) != Some(0x3000)
        {
            continue;
        }
        let Some(player) = (unsafe { read_agent(layout, agent_buffer, size, id) }) else {
            return state;
        };
        state.flags = FLAG_READY | FLAG_PLAYER_VALID;
        state.map_id = map_id;
        state.instance_type = instance_type;
        state.play_region = play_region;
        state.player = player;
        break;
    }
    if state.flags & FLAG_PLAYER_VALID == 0 {
        return State::empty();
    }

    if observe_target
        && play_region == PLAY_REGION_PVE
        && layout.manual_target_agent_id != 0
        && layout.automatic_target_agent_id != 0
    {
        let target_id = unsafe { read_u32(layout.manual_target_agent_id) }
            .filter(|id| *id != 0)
            .or_else(|| unsafe { read_u32(layout.automatic_target_agent_id) });
        if let Some(target_id) = target_id {
            if let Some(target) = unsafe { read_agent(layout, agent_buffer, size, target_id) } {
                let dx = target.x - state.player.x;
                let dy = target.y - state.player.y;
                let distance_squared = dx * dx + dy * dy;
                if distance_squared.is_finite() {
                    state.flags |= FLAG_TARGET_VALID;
                    state.target = target;
                    state.distance = square_root(distance_squared);
                    state.band = range_band(distance_squared);
                }
            }
        }
    }
    state
}

/// The player's own hero count and the identity of the first of them.
///
/// `None` is "the party could not be read" — a rejected pointer, an array whose
/// header contradicts itself, a hero id outside the table. `Some((0, 0, 0))` is
/// "read fine, you have no heroes". Both used to be `(0, 0, 0)`, which made a
/// failed walk indistinguishable from an empty party, and the interface duly
/// reported an empty party during every map load.
pub(crate) unsafe fn collect_first_owned_hero(
    layout: Layout,
    game: u32,
    player_number: u32,
) -> Option<(u32, u32, u32)> {
    if game == 0
        || player_number == 0
        || layout.hero_member_stride < 12
        || layout.hero_member_stride > 64
        || layout.hero_agent_id + 4 > layout.hero_member_stride
        || layout.hero_owner_player_id + 4 > layout.hero_member_stride
        || layout.hero_id + 4 > layout.hero_member_stride
    {
        return None;
    }
    let party_required = match checked_add(layout.player_party, 4) {
        Some(value) => value,
        None => return None,
    };
    let info_required = match checked_add(layout.party_heroes, 12) {
        Some(value) => value,
        None => return None,
    };
    let party = match offset(game, layout.party_context)
        .and_then(|at| unsafe { pointer(at, party_required) })
    {
        Some(value) => value,
        None => return None,
    };
    let info = match offset(party, layout.player_party)
        .and_then(|at| unsafe { pointer(at, info_required) })
    {
        Some(value) => value,
        None => return None,
    };
    let array = match offset(info, layout.party_heroes) {
        Some(value) if contains(value, 12) => value,
        _ => return None,
    };
    let Some(buffer) = (unsafe { read_u32(array) }) else {
        return None;
    };
    let Some(capacity) = offset(array, 4).and_then(|at| unsafe { read_u32(at) }) else {
        return None;
    };
    let Some(size) = offset(array, 8).and_then(|at| unsafe { read_u32(at) }) else {
        return None;
    };
    if size > capacity || capacity > 64 {
        return None;
    }
    if size > 0 {
        let Some(bytes) = checked_mul(size, layout.hero_member_stride) else {
            return None;
        };
        if buffer == 0 || buffer & 3 != 0 || !contains(buffer, bytes) {
            return None;
        }
    }

    let mut count = 0;
    let mut first_id = 0;
    let mut first_agent = 0;
    let mut owned_ids = [0_u32; 7];
    for index in 0..size {
        let Some(member) = indexed(buffer, index, layout.hero_member_stride) else {
            return None;
        };
        let Some(owner) =
            offset(member, layout.hero_owner_player_id).and_then(|at| unsafe { read_u32(at) })
        else {
            return None;
        };
        let Some(hero_id) = offset(member, layout.hero_id).and_then(|at| unsafe { read_u32(at) })
        else {
            return None;
        };
        let Some(agent_id) =
            offset(member, layout.hero_agent_id).and_then(|at| unsafe { read_u32(at) })
        else {
            return None;
        };
        if !(1..=39).contains(&hero_id) {
            return None;
        }
        if owner != player_number {
            continue;
        }
        if count >= 7 || owned_ids[..count as usize].contains(&hero_id) {
            return None;
        }
        owned_ids[count as usize] = hero_id;
        if count == 0 {
            first_id = hero_id;
            first_agent = agent_id;
        }
        count += 1;
    }
    Some((count, first_id, first_agent))
}

// The odd sequence brackets the write: a reader that sees it discards the
// frame rather than decoding a half-written one.
unsafe fn publish(state: State) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    // SAFETY: every successful `companion_init` assigns `SNAPSHOT_PTR`, and it
    // is null unless that init carried `FEATURE_TARGET_READOUT`. When the flag
    // was set, `valid_region` proved a non-null, four-byte-aligned
    // `SNAPSHOT_BYTES` region inside linear memory. What makes the store sound
    // is that every caller of `publish` is gated on that same flag from that
    // same init, and memory never shrinks, so the region is still there.
    let snapshot = unsafe { SNAPSHOT_PTR as *mut Snapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, state.flags);
        write_volatile(&mut (*snapshot).tick_count, TICK_COUNT);
        write_volatile(&mut (*snapshot).map_id, state.map_id);
        write_volatile(
            &mut (*snapshot).instance_and_region,
            state.instance_type | (state.play_region << 8),
        );
        write_volatile(&mut (*snapshot).player_id, state.player.id);
        write_volatile(&mut (*snapshot).player_x, state.player.x);
        write_volatile(&mut (*snapshot).player_y, state.player.y);
        write_volatile(&mut (*snapshot).target_id, state.target.id);
        write_volatile(&mut (*snapshot).target_type, state.target.kind);
        write_volatile(&mut (*snapshot).target_x, state.target.x);
        write_volatile(&mut (*snapshot).target_y, state.target.y);
        write_volatile(&mut (*snapshot).distance, state.distance);
        write_volatile(&mut (*snapshot).range_band, state.band);
        write_volatile(&mut (*snapshot).sequence, next);
        SEQUENCE = next;
    }
}

#[no_mangle]
pub unsafe extern "C" fn companion_init(
    snapshot_ptr: u32,
    snapshot_size: u32,
    config_ptr: u32,
    config_size: u32,
    cursor_ptr: u32,
    cursor_size: u32,
    toolbox_ptr: u32,
    toolbox_size: u32,
    party_ptr: u32,
    party_size: u32,
    features: u32,
) -> u32 {
    if features == 0
        || features & !KNOWN_FEATURES != 0
        || config_size != CONFIG_BYTES
        || config_ptr & 3 != 0
        || !contains(config_ptr, config_size)
        || !valid_region(
            features & FEATURE_TARGET_READOUT != 0,
            snapshot_ptr,
            snapshot_size,
            SNAPSHOT_BYTES,
        )
        || !valid_region(
            features & FEATURE_NATIVE_CURSOR != 0,
            cursor_ptr,
            cursor_size,
            CURSOR_BYTES,
        )
        || !valid_region(
            features & FEATURE_TOOLBOX_FOUNDATION != 0,
            toolbox_ptr,
            toolbox_size,
            TOOLBOX_BYTES,
        )
        // The party region rides on the same capability as the toolbox one:
        // it is the same observation, complete rather than truncated, and a
        // second feature bit would only add a half-enabled state to reason
        // about. FEATURE_NATIVE_CURSOR already owns two regions this way.
        || !valid_region(
            features & FEATURE_TOOLBOX_FOUNDATION != 0,
            party_ptr,
            party_size,
            PARTY_BYTES,
        )
    {
        return 0;
    }
    // SAFETY: the guard above refused anything but a four-byte-aligned
    // `config_ptr` with `CONFIG_BYTES` inside linear memory. `Layout` is a
    // `repr(C)` block of `u32`, so every bit pattern the host can leave there
    // is a valid value and the copy cannot observe an invalid one.
    let layout = unsafe { read_volatile(config_ptr as *const Layout) };
    if features & FEATURE_TOOLBOX_FOUNDATION != 0 && !valid_toolbox_messages(layout) {
        return 0;
    }
    // SAFETY: each `initialize` takes the region its feature flag made
    // `valid_region` demand, so the pointer it stores is non-null, aligned, and
    // large enough for the snapshot it will publish.
    unsafe {
        SNAPSHOT_PTR = snapshot_ptr;
        LAYOUT = layout;
        FEATURES = features;
        // The renderer replaces this with its live settings before installing
        // the callback. Keeping init self-contained also makes the ABI useful
        // to the standalone validation harness.
        ACTIVE_FEATURES = features;
        INITIALIZED = true;
        TICK_COUNT = 0;
        SEQUENCE = 0;
        if features & FEATURE_TARGET_READOUT != 0 {
            publish(State::empty());
        }
        if features & FEATURE_NATIVE_CURSOR != 0 {
            cursor::initialize(cursor_ptr);
        }
        if features & FEATURE_TOOLBOX_FOUNDATION != 0 {
            toolbox::initialize(toolbox_ptr);
            party::initialize(party_ptr);
        }
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn companion_dispatch(kind: u32, a: u32, b: u32, _c: u32, _d: u32, _e: u32) {
    match kind {
        DISPATCH_TICK => {
            if !unsafe { INITIALIZED } {
                return;
            }
            let features = unsafe { FEATURES };
            let active = unsafe { ACTIVE_FEATURES };
            let layout = unsafe { LAYOUT };
            unsafe { TICK_COUNT = TICK_COUNT.wrapping_add(1) };
            let state = if features & FEATURE_TARGET_READOUT != 0 {
                unsafe { collect(layout, active & FEATURE_TARGET_READOUT != 0) }
            } else {
                State::empty()
            };
            if features & FEATURE_TARGET_READOUT != 0 {
                unsafe { publish(state) };
            }
            if active & FEATURE_TOOLBOX_FOUNDATION != 0 {
                unsafe { toolbox::tick(layout, TICK_COUNT) };
                unsafe { party::tick_if_dirty(layout, TICK_COUNT) };
            }
            if features & FEATURE_NATIVE_CURSOR != 0 {
                unsafe { cursor::tick(layout) };
            }
        }
        DISPATCH_CURSOR => {
            if unsafe { INITIALIZED } && unsafe { FEATURES } & FEATURE_NATIVE_CURSOR != 0 {
                unsafe {
                    cursor::mark_dirty();
                    if ACTIVE_FEATURES & FEATURE_TOOLBOX_FOUNDATION != 0 {
                        toolbox::publish_cursor_event();
                    }
                }
            }
        }
        DISPATCH_UI => {
            if !unsafe { INITIALIZED }
                || unsafe { ACTIVE_FEATURES } & FEATURE_TOOLBOX_FOUNDATION == 0
            {
                return;
            }
            unsafe {
                let layout = LAYOUT;
                toolbox::observe_ui(layout, a, b);
            }
        }
        DISPATCH_ACTIVE_FEATURES => {
            if !unsafe { INITIALIZED } {
                return;
            }
            let available = unsafe { FEATURES };
            if a & !available != 0 || a & FEATURE_NATIVE_CURSOR != available & FEATURE_NATIVE_CURSOR
            {
                return;
            }
            let previous = unsafe { ACTIVE_FEATURES };
            unsafe { ACTIVE_FEATURES = a };
            if previous & FEATURE_TOOLBOX_FOUNDATION == 0 && a & FEATURE_TOOLBOX_FOUNDATION != 0 {
                unsafe {
                    toolbox::mark_dirty();
                    party::mark_dirty();
                }
            }
        }
        _ => {}
    }
}

#[no_mangle]
pub extern "C" fn companion_abi() -> u32 {
    13
}

#[no_mangle]
pub extern "C" fn companion_config_bytes() -> u32 {
    CONFIG_BYTES
}

#[no_mangle]
pub extern "C" fn companion_snapshot_bytes() -> u32 {
    SNAPSHOT_BYTES
}

#[no_mangle]
pub extern "C" fn companion_cursor_bytes() -> u32 {
    CURSOR_BYTES
}

#[no_mangle]
pub extern "C" fn companion_toolbox_bytes() -> u32 {
    TOOLBOX_BYTES
}

#[no_mangle]
pub extern "C" fn companion_party_bytes() -> u32 {
    PARTY_BYTES
}

#[no_mangle]
pub unsafe extern "C" fn companion_cursor_event_count() -> u32 {
    if unsafe { INITIALIZED } {
        unsafe { cursor::event_count() }
    } else {
        0
    }
}
