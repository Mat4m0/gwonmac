#![no_std]

use core::mem::size_of;
use core::panic::PanicInfo;
use core::ptr::{read_volatile, write_volatile};

const SNAPSHOT_BYTES: u32 = size_of::<Snapshot>() as u32;
const CONFIG_BYTES: u32 = size_of::<Layout>() as u32;
const MAGIC: u32 = 0x4254_5747;
const ABI_AND_SIZE: u32 = (SNAPSHOT_BYTES << 16) | 1;

const FLAG_READY: u32 = 1 << 0;
const FLAG_PLAYER_VALID: u32 = 1 << 1;
const FLAG_TARGET_VALID: u32 = 1 << 2;
const FLAG_LOADING: u32 = 1 << 3;

const FEATURE_NATIVE_CURSOR: u32 = 1 << 0;
const FEATURE_TARGET_READOUT: u32 = 1 << 1;
const FEATURE_TOOLBOX_FOUNDATION: u32 = 1 << 2;
const KNOWN_FEATURES: u32 =
    FEATURE_NATIVE_CURSOR | FEATURE_TARGET_READOUT | FEATURE_TOOLBOX_FOUNDATION;

const TOOLBOX_BYTES: u32 = size_of::<ToolboxSnapshot>() as u32;
const TOOLBOX_MAGIC: u32 = 0x5854_5747;
const TOOLBOX_ABI_AND_SIZE: u32 = (TOOLBOX_BYTES << 16) | 1;
const FLAG_HERO_AVAILABLE: u32 = 1 << 0;

const DISPATCH_TICK: u32 = 0;
const DISPATCH_CURSOR: u32 = 1;
const DISPATCH_UI: u32 = 2;
const PANEL_UNKNOWN: u32 = 0;
const PANEL_HIDDEN: u32 = 1;
const PANEL_SHOWN: u32 = 2;
const COMMAND_IDLE: u32 = 0;
const COMMAND_APPLIED: u32 = 1;
const COMMAND_UNAVAILABLE: u32 = 2;

const CURSOR_BYTES: u32 = size_of::<CursorSnapshot>() as u32;
const CURSOR_MAGIC: u32 = 0x4354_5747;
const CURSOR_ABI_AND_SIZE: u32 = (CURSOR_BYTES << 16) | 1;

const FLAG_CURSOR_VALID: u32 = 1 << 0;
const FLAG_CURSOR_HIDDEN: u32 = 1 << 1;
const FLAG_CURSOR_UNSUPPORTED: u32 = 1 << 2;

const CURSOR_EDGE: u32 = 32;
const CURSOR_WORDS: u32 = CURSOR_EDGE * CURSOR_EDGE;
const CURSOR_PIXEL_BYTES: u32 = CURSOR_WORDS * 4;
// 'grtx', the texture handle's access key.
const CURSOR_TEXTURE_KEY: u32 = 0x6772_7478;
const CURSOR_TEXTURE_TYPE: u32 = 10;

#[repr(C)]
#[derive(Clone, Copy)]
struct Layout {
    context_root: u32,
    agent_array: u32,
    manual_target_agent_id: u32,
    automatic_target_agent_id: u32,
    game_context_slot: u32,
    character_context: u32,
    map_id: u32,
    is_explorable: u32,
    current_map_id: u32,
    current_instance_type: u32,
    player_number: u32,
    agent_id: u32,
    agent_x: u32,
    agent_y: u32,
    agent_type: u32,
    agent_player_number: u32,
    agent_model_type: u32,
    cursor_active_art: u32,
    cursor_software_model: u32,
    cursor_show_count: u32,
    cursor_color_buffer: u32,
    cursor_art_hotspot: u32,
    cursor_art_texture: u32,
    cursor_handle_key: u32,
    cursor_handle_object: u32,
    cursor_view_texture: u32,
    cursor_texture_type: u32,
    cursor_texture_width: u32,
    cursor_texture_height: u32,
    party_context: u32,
    player_party: u32,
    party_heroes: u32,
    hero_member_stride: u32,
    hero_agent_id: u32,
    hero_owner_player_id: u32,
    hero_id: u32,
    player_chat_message: u32,
    hide_hero_panel_message: u32,
    show_hero_panel_message: u32,
}

impl Layout {
    const EMPTY: Self = Self {
        context_root: 0,
        agent_array: 0,
        manual_target_agent_id: 0,
        automatic_target_agent_id: 0,
        game_context_slot: 0,
        character_context: 0,
        map_id: 0,
        is_explorable: 0,
        current_map_id: 0,
        current_instance_type: 0,
        player_number: 0,
        agent_id: 0,
        agent_x: 0,
        agent_y: 0,
        agent_type: 0,
        agent_player_number: 0,
        agent_model_type: 0,
        cursor_active_art: 0,
        cursor_software_model: 0,
        cursor_show_count: 0,
        cursor_color_buffer: 0,
        cursor_art_hotspot: 0,
        cursor_art_texture: 0,
        cursor_handle_key: 0,
        cursor_handle_object: 0,
        cursor_view_texture: 0,
        cursor_texture_type: 0,
        cursor_texture_width: 0,
        cursor_texture_height: 0,
        party_context: 0,
        player_party: 0,
        party_heroes: 0,
        hero_member_stride: 0,
        hero_agent_id: 0,
        hero_owner_player_id: 0,
        hero_id: 0,
        player_chat_message: 0,
        hide_hero_panel_message: 0,
        show_hero_panel_message: 0,
    };
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Snapshot {
    magic: u32,
    abi_and_size: u32,
    sequence: u32,
    flags: u32,
    tick_count: u32,
    map_id: u32,
    instance_type: u32,
    player_id: u32,
    player_x: f32,
    player_y: f32,
    target_id: u32,
    target_type: u32,
    target_x: f32,
    target_y: f32,
    distance: f32,
    range_band: u32,
}

// Separate bounded region: the 64-byte core snapshot is full, and the cursor
// bitmap is far too large to live in it.
#[repr(C)]
struct CursorSnapshot {
    magic: u32,
    abi_and_size: u32,
    sequence: u32,
    flags: u32,
    generation: u32,
    width: u32,
    height: u32,
    hotspot_x: u32,
    hotspot_y: u32,
    pixel_hash: u32,
    reserved: [u32; 6],
    pixels: [u32; 1024],
}

#[repr(C)]
struct ToolboxSnapshot {
    magic: u32,
    abi_and_size: u32,
    sequence: u32,
    flags: u32,
    player_chat_count: u32,
    cursor_event_count: u32,
    hero_count: u32,
    first_hero_id: u32,
    first_hero_agent_id: u32,
    panel_state: u32,
    command_request: u32,
    command_complete: u32,
    command_status: u32,
    reserved: [u32; 3],
}

const _: [(); 156] = [(); size_of::<Layout>()];
const _: [(); 64] = [(); size_of::<Snapshot>()];
const _: [(); 4160] = [(); size_of::<CursorSnapshot>()];
const _: [(); 64] = [(); size_of::<ToolboxSnapshot>()];

static mut SNAPSHOT_PTR: u32 = 0;
static mut LAYOUT: Layout = Layout::EMPTY;
static mut INITIALIZED: bool = false;
static mut FEATURES: u32 = 0;
static mut TICK_COUNT: u32 = 0;
static mut SEQUENCE: u32 = 0;
static mut CURSOR_PTR: u32 = 0;
static mut CURSOR_SEQUENCE: u32 = 0;
static mut CURSOR_GENERATION: u32 = 0;
static mut CURSOR_PUBLISHED: CursorPublished = CursorPublished::EMPTY;
static mut CURSOR_DIRTY: bool = true;
static mut CURSOR_EVENT_COUNT: u32 = 0;
static mut TOOLBOX_PTR: u32 = 0;
static mut TOOLBOX_SEQUENCE: u32 = 0;
static mut PLAYER_CHAT_COUNT: u32 = 0;
static mut HERO_COUNT: u32 = 0;
static mut FIRST_HERO_ID: u32 = 0;
static mut FIRST_HERO_AGENT_ID: u32 = 0;
static mut PANEL_STATE: u32 = PANEL_UNKNOWN;
static mut PANEL_PENDING: u32 = PANEL_UNKNOWN;
static mut COMMAND_REQUEST: u32 = 0;
static mut COMMAND_COMPLETE: u32 = 0;
static mut COMMAND_STATUS: u32 = COMMAND_IDLE;

#[link(wasm_import_module = "game")]
extern "C" {
    #[link_name = "enhancement_tick_original"]
    fn tick_original(context: u32);
    #[link_name = "enhancement_cursor_original"]
    fn cursor_original(a: u32, b: u32, c: u32, d: u32, e: u32);
    #[link_name = "enhancement_ui_original"]
    fn ui_original(message: u32, wparam: u32, lparam: u32);
}

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

fn memory_bytes() -> u32 {
    core::arch::wasm32::memory_size(0)
        .saturating_mul(65_536)
        .min(u32::MAX as usize) as u32
}

fn checked_add(left: u32, right: u32) -> Option<u32> {
    left.checked_add(right)
}

fn checked_mul(left: u32, right: u32) -> Option<u32> {
    left.checked_mul(right)
}

fn offset(base: u32, field: u32) -> Option<u32> {
    checked_add(base, field)
}

fn indexed(base: u32, index: u32, stride: u32) -> Option<u32> {
    checked_add(base, checked_mul(index, stride)?)
}

fn contains(address: u32, bytes: u32) -> bool {
    checked_add(address, bytes).is_some_and(|end| end <= memory_bytes())
}

fn valid_region(enabled: bool, address: u32, bytes: u32, expected: u32) -> bool {
    if enabled {
        address != 0 && bytes == expected && address & 3 == 0 && contains(address, bytes)
    } else {
        address == 0 && bytes == 0
    }
}

unsafe fn read_u32(address: u32) -> Option<u32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const u32) })
}

unsafe fn read_i32(address: u32) -> Option<i32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const i32) })
}

unsafe fn read_u16(address: u32) -> Option<u16> {
    contains(address, 2).then(|| unsafe { read_volatile(address as *const u16) })
}

unsafe fn read_f32(address: u32) -> Option<f32> {
    contains(address, 4).then(|| unsafe { read_volatile(address as *const f32) })
}

unsafe fn pointer(address: u32, required_bytes: u32) -> Option<u32> {
    let value = unsafe { read_u32(address)? };
    (value & 3 == 0 && contains(value, required_bytes)).then_some(value)
}

fn finite_position(value: f32) -> bool {
    value.is_finite() && value.abs() <= 1_000_000.0
}

fn valid_agent_type(value: u32) -> bool {
    value & (0x400 | 0x200 | 0xdb) != 0
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
    game: u32,
    map_id: u32,
    instance_type: u32,
    player_number: u32,
    player: AgentState,
    target: AgentState,
    distance: f32,
    band: u32,
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
            game: 0,
            map_id: 0,
            instance_type: 0,
            player_number: 0,
            player: EMPTY_AGENT,
            target: EMPTY_AGENT,
            distance: 0.0,
            band: 0,
        }
    }
}

unsafe fn read_agent(
    layout: Layout,
    agent_buffer: u32,
    size: u32,
    id: u32,
) -> Option<AgentState> {
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

unsafe fn collect(layout: Layout) -> State {
    let mut state = State::empty();
    let contexts = match unsafe { pointer(layout.context_root, 28) } {
        Some(value) => value,
        None => return state,
    };
    let game_slot = match indexed(contexts, layout.game_context_slot, 4) {
        Some(value) => value,
        None => return state,
    };
    let game = match unsafe { pointer(game_slot, 0x50) } {
        Some(value) => value,
        None => return state,
    };
    let character = match offset(game, layout.character_context)
        .and_then(|address| unsafe { pointer(address, 0x2b0) })
    {
        Some(value) => value,
        None => return state,
    };

    let read_character = |field| {
        offset(character, field).and_then(|address| unsafe { read_u32(address) })
    };
    let Some(base_map) = read_character(layout.map_id) else {
        return state;
    };
    let Some(is_explorable) = read_character(layout.is_explorable) else {
        return state;
    };
    let Some(map_id) = read_character(layout.current_map_id) else {
        return state;
    };
    let Some(instance_type) = read_character(layout.current_instance_type) else {
        return state;
    };
    let Some(player_number) = read_character(layout.player_number) else {
        return state;
    };
    if instance_type == 2 {
        state.flags = FLAG_LOADING;
        return state;
    }
    if map_id == 0
        || map_id > 2_000
        || base_map != map_id
        || instance_type > 1
        || is_explorable != u32::from(instance_type == 1)
        || player_number == 0
        || player_number > u16::MAX as u32
    {
        return state;
    }

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
    if size == 0
        || size > capacity
        || capacity > 4_096
        || !contains(agent_buffer, agent_bytes)
    {
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
        let Some(player_number_address) =
            offset(agent_address, layout.agent_player_number)
        else {
            return state;
        };
        let Some(model_type_address) = offset(agent_address, layout.agent_model_type)
        else {
            return state;
        };
        if unsafe { read_u32(id_address) } != Some(id)
            || unsafe { read_u16(player_number_address) } != Some(player_number as u16)
            || unsafe { read_u16(model_type_address) }.map(|value| value & 0xf000)
                != Some(0x3000)
        {
            continue;
        }
        let Some(player) = (unsafe { read_agent(layout, agent_buffer, size, id) })
        else {
            return state;
        };
        state.flags = FLAG_READY | FLAG_PLAYER_VALID;
        state.game = game;
        state.map_id = map_id;
        state.instance_type = instance_type;
        state.player_number = player_number;
        state.player = player;
        break;
    }
    if state.flags & FLAG_PLAYER_VALID == 0 {
        return State::empty();
    }

    if layout.manual_target_agent_id != 0
        && layout.automatic_target_agent_id != 0
    {
        let target_id = unsafe { read_u32(layout.manual_target_agent_id) }
            .filter(|id| *id != 0)
            .or_else(|| unsafe { read_u32(layout.automatic_target_agent_id) });
        if let Some(target_id) = target_id {
            if let Some(target) =
                unsafe { read_agent(layout, agent_buffer, size, target_id) }
            {
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

unsafe fn collect_first_owned_hero(layout: Layout, state: State) -> (u32, u32, u32) {
    if state.flags & (FLAG_READY | FLAG_PLAYER_VALID)
        != (FLAG_READY | FLAG_PLAYER_VALID)
        || state.game == 0
        || state.player_number == 0
        || layout.hero_member_stride < 12
        || layout.hero_member_stride > 64
        || layout.hero_agent_id + 4 > layout.hero_member_stride
        || layout.hero_owner_player_id + 4 > layout.hero_member_stride
        || layout.hero_id + 4 > layout.hero_member_stride
    {
        return (0, 0, 0);
    }
    let party_required = match checked_add(layout.player_party, 4) {
        Some(value) => value,
        None => return (0, 0, 0),
    };
    let info_required = match checked_add(layout.party_heroes, 12) {
        Some(value) => value,
        None => return (0, 0, 0),
    };
    let party = match offset(state.game, layout.party_context)
        .and_then(|at| unsafe { pointer(at, party_required) })
    {
        Some(value) => value,
        None => return (0, 0, 0),
    };
    let info = match offset(party, layout.player_party)
        .and_then(|at| unsafe { pointer(at, info_required) })
    {
        Some(value) => value,
        None => return (0, 0, 0),
    };
    let array = match offset(info, layout.party_heroes) {
        Some(value) if contains(value, 12) => value,
        _ => return (0, 0, 0),
    };
    let Some(buffer) = (unsafe { read_u32(array) }) else {
        return (0, 0, 0);
    };
    let Some(capacity) = offset(array, 4).and_then(|at| unsafe { read_u32(at) }) else {
        return (0, 0, 0);
    };
    let Some(size) = offset(array, 8).and_then(|at| unsafe { read_u32(at) }) else {
        return (0, 0, 0);
    };
    if size > capacity || capacity > 64 {
        return (0, 0, 0);
    }
    if size > 0 {
        let Some(bytes) = checked_mul(size, layout.hero_member_stride) else {
            return (0, 0, 0);
        };
        if buffer == 0 || buffer & 3 != 0 || !contains(buffer, bytes) {
            return (0, 0, 0);
        }
    }

    let mut count = 0;
    let mut first_id = 0;
    let mut first_agent = 0;
    let mut owned_ids = [0_u32; 7];
    for index in 0..size {
        let Some(member) = indexed(buffer, index, layout.hero_member_stride) else {
            return (0, 0, 0);
        };
        let Some(owner) = offset(member, layout.hero_owner_player_id)
            .and_then(|at| unsafe { read_u32(at) })
        else {
            return (0, 0, 0);
        };
        let Some(hero_id) = offset(member, layout.hero_id)
            .and_then(|at| unsafe { read_u32(at) })
        else {
            return (0, 0, 0);
        };
        let Some(agent_id) = offset(member, layout.hero_agent_id)
            .and_then(|at| unsafe { read_u32(at) })
        else {
            return (0, 0, 0);
        };
        if !(1..=39).contains(&hero_id) {
            return (0, 0, 0);
        }
        if owner != state.player_number {
            continue;
        }
        if count >= 7 || owned_ids[..count as usize].contains(&hero_id) {
            return (0, 0, 0);
        }
        owned_ids[count as usize] = hero_id;
        if count == 0 {
            first_id = hero_id;
            first_agent = agent_id;
        }
        count += 1;
    }
    (count, first_id, first_agent)
}

unsafe fn publish_toolbox() {
    let next = unsafe { TOOLBOX_SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { TOOLBOX_PTR as *mut ToolboxSnapshot };
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
        write_volatile(&mut (*snapshot).cursor_event_count, CURSOR_EVENT_COUNT);
        write_volatile(&mut (*snapshot).hero_count, HERO_COUNT);
        write_volatile(&mut (*snapshot).first_hero_id, FIRST_HERO_ID);
        write_volatile(&mut (*snapshot).first_hero_agent_id, FIRST_HERO_AGENT_ID);
        write_volatile(&mut (*snapshot).panel_state, PANEL_STATE);
        write_volatile(&mut (*snapshot).command_request, COMMAND_REQUEST);
        write_volatile(&mut (*snapshot).command_complete, COMMAND_COMPLETE);
        write_volatile(&mut (*snapshot).command_status, COMMAND_STATUS);
        write_volatile(&mut (*snapshot).sequence, next);
        TOOLBOX_SEQUENCE = next;
    }
}

unsafe fn tick_foundation(layout: Layout, state: State) {
    let (count, hero_id, agent_id) = unsafe { collect_first_owned_hero(layout, state) };
    unsafe {
        if FIRST_HERO_ID != hero_id {
            PANEL_STATE = PANEL_UNKNOWN;
        }
        HERO_COUNT = count;
        FIRST_HERO_ID = hero_id;
        FIRST_HERO_AGENT_ID = agent_id;
    }
    let desired = unsafe { PANEL_PENDING };
    if desired != PANEL_UNKNOWN {
        unsafe { PANEL_PENDING = PANEL_UNKNOWN };
        if hero_id == 0 {
            unsafe {
                COMMAND_COMPLETE = COMMAND_REQUEST;
                COMMAND_STATUS = COMMAND_UNAVAILABLE;
            }
        } else {
            let message = if desired == PANEL_SHOWN {
                layout.show_hero_panel_message
            } else {
                layout.hide_hero_panel_message
            };
            unsafe { ui_original(message, hero_id, 0) };
            unsafe {
                PANEL_STATE = desired;
                COMMAND_COMPLETE = COMMAND_REQUEST;
                COMMAND_STATUS = COMMAND_APPLIED;
            }
        }
    }
    unsafe { publish_toolbox() };
}

unsafe fn publish(state: State) {
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    let snapshot = unsafe { SNAPSHOT_PTR as *mut Snapshot };
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, state.flags);
        write_volatile(&mut (*snapshot).tick_count, TICK_COUNT);
        write_volatile(&mut (*snapshot).map_id, state.map_id);
        write_volatile(&mut (*snapshot).instance_type, state.instance_type);
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

#[derive(Clone, Copy)]
struct CursorState {
    hash: u32,
    hotspot_x: u32,
    hotspot_y: u32,
    hidden: bool,
    source: u32,
}

// The published identity. The active art pointer is not stable across cursor
// changes, so the pixel hash is the only usable change key.
#[derive(Clone, Copy, PartialEq)]
struct CursorPublished {
    flags: u32,
    hash: u32,
    hotspot_x: u32,
    hotspot_y: u32,
}

impl CursorPublished {
    const EMPTY: Self = Self {
        flags: 0,
        hash: 0,
        hotspot_x: 0,
        hotspot_y: 0,
    };
}

// FNV-1a over the source BGRA words, so an unchanged cursor costs one pass and
// no conversion. None means unreadable or never committed by the game.
unsafe fn hash_cursor_pixels(source: u32) -> Option<u32> {
    let mut hash: u32 = 0x811c_9dc5;
    let mut committed: u32 = 0;
    for index in 0..CURSOR_WORDS {
        let word = unsafe { read_u32(indexed(source, index, 4)?)? };
        hash = (hash ^ word).wrapping_mul(0x0100_0193);
        committed |= word;
    }
    (committed != 0).then_some(hash)
}

// The readback that fills the colour buffer uses a hard-coded pitch, so a
// source texture that is not 32x32 would have misfilled it.
unsafe fn read_cursor(layout: Layout) -> Option<CursorState> {
    let art = unsafe { pointer(layout.cursor_active_art, 24)? };
    let handle = unsafe { pointer(offset(art, layout.cursor_art_texture)?, 12)? };
    if unsafe { read_u32(offset(handle, layout.cursor_handle_key)?)? }
        != CURSOR_TEXTURE_KEY
    {
        return None;
    }
    let view = unsafe { pointer(offset(handle, layout.cursor_handle_object)?, 12)? };
    let texture = unsafe { pointer(offset(view, layout.cursor_view_texture)?, 0x68)? };
    if unsafe { read_u32(offset(texture, layout.cursor_texture_type)?)? }
        != CURSOR_TEXTURE_TYPE
        || unsafe { read_u32(offset(texture, layout.cursor_texture_width)?)? }
            != CURSOR_EDGE
        || unsafe { read_u32(offset(texture, layout.cursor_texture_height)?)? }
            != CURSOR_EDGE
    {
        return None;
    }

    let hotspot = offset(art, layout.cursor_art_hotspot)?;
    let hotspot_x = unsafe { read_u32(hotspot)? };
    let hotspot_y = unsafe { read_u32(offset(hotspot, 4)?)? };
    if hotspot_x >= CURSOR_EDGE || hotspot_y >= CURSOR_EDGE {
        return None;
    }

    let source = layout.cursor_color_buffer;
    if !contains(source, CURSOR_PIXEL_BYTES) {
        return None;
    }
    let hash = unsafe { hash_cursor_pixels(source)? };
    let hidden = unsafe { read_i32(layout.cursor_show_count) }
        .is_some_and(|count| count < 0);
    Some(CursorState {
        hash,
        hotspot_x,
        hotspot_y,
        hidden,
        source,
    })
}

unsafe fn collect_cursor(layout: Layout) -> Result<CursorState, u32> {
    if unsafe { read_u32(layout.cursor_software_model) } != Some(0) {
        return Err(FLAG_CURSOR_UNSUPPORTED);
    }
    unsafe { read_cursor(layout) }.ok_or(0)
}

// `source` is None for a header-only update: it clears CURSOR_VALID without
// disturbing the last good pixels.
unsafe fn publish_cursor(published: CursorPublished, source: Option<u32>) {
    let next = unsafe { CURSOR_SEQUENCE }.wrapping_add(2) & !1;
    let cursor = unsafe { CURSOR_PTR as *mut CursorSnapshot };
    unsafe {
        write_volatile(&mut (*cursor).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*cursor).magic, CURSOR_MAGIC);
        write_volatile(&mut (*cursor).abi_and_size, CURSOR_ABI_AND_SIZE);
        write_volatile(&mut (*cursor).flags, published.flags);
    }
    if let Some(source) = source {
        unsafe {
            CURSOR_GENERATION = CURSOR_GENERATION.wrapping_add(1);
            write_volatile(&mut (*cursor).generation, CURSOR_GENERATION);
            write_volatile(&mut (*cursor).width, CURSOR_EDGE);
            write_volatile(&mut (*cursor).height, CURSOR_EDGE);
            write_volatile(&mut (*cursor).hotspot_x, published.hotspot_x);
            write_volatile(&mut (*cursor).hotspot_y, published.hotspot_y);
            write_volatile(&mut (*cursor).pixel_hash, published.hash);
        }
        for index in 0..CURSOR_WORDS {
            let word = indexed(source, index, 4)
                .and_then(|address| unsafe { read_u32(address) })
                .unwrap_or(0);
            // BGRA -> RGBA: keep alpha and green, swap red and blue.
            let rgba =
                (word & 0xff00_ff00) | ((word >> 16) & 0xff) | ((word & 0xff) << 16);
            unsafe { write_volatile(&mut (*cursor).pixels[index as usize], rgba) };
        }
    }
    unsafe {
        write_volatile(&mut (*cursor).sequence, next);
        CURSOR_SEQUENCE = next;
        CURSOR_PUBLISHED = published;
    }
}

unsafe fn tick_cursor(layout: Layout) {
    if !unsafe { CURSOR_DIRTY } {
        let last = unsafe { CURSOR_PUBLISHED };
        if last.flags & FLAG_CURSOR_VALID == 0 {
            return;
        }
        if let Some(count) = unsafe { read_i32(layout.cursor_show_count) } {
            let flags = FLAG_CURSOR_VALID
                | if count < 0 { FLAG_CURSOR_HIDDEN } else { 0 };
            if flags != last.flags {
                unsafe { publish_cursor(CursorPublished { flags, ..last }, None) };
            }
        }
        return;
    }
    unsafe { CURSOR_DIRTY = false };
    let last = unsafe { CURSOR_PUBLISHED };
    match unsafe { collect_cursor(layout) } {
        Ok(state) => {
            let published = CursorPublished {
                flags: FLAG_CURSOR_VALID
                    | if state.hidden { FLAG_CURSOR_HIDDEN } else { 0 },
                hash: state.hash,
                hotspot_x: state.hotspot_x,
                hotspot_y: state.hotspot_y,
            };
            if published != last {
                // Show/hide moves the flags alone, and the region already holds
                // the bitmap `published.hash` names, so skip the 4 KB rewrite.
                let bitmap = last.flags & FLAG_CURSOR_VALID == 0
                    || published.hash != last.hash
                    || published.hotspot_x != last.hotspot_x
                    || published.hotspot_y != last.hotspot_y;
                unsafe { publish_cursor(published, bitmap.then_some(state.source)) };
            }
        }
        Err(flags) => {
            if flags != last.flags {
                unsafe { publish_cursor(CursorPublished { flags, ..last }, None) };
            }
        }
    }
}

// The region comes from the game's allocator, so clear it before the renderer
// can observe it.
unsafe fn clear_cursor() {
    let cursor = unsafe { CURSOR_PTR as *mut CursorSnapshot };
    unsafe {
        write_volatile(&mut (*cursor).generation, 0);
        write_volatile(&mut (*cursor).width, 0);
        write_volatile(&mut (*cursor).height, 0);
        write_volatile(&mut (*cursor).hotspot_x, 0);
        write_volatile(&mut (*cursor).hotspot_y, 0);
        write_volatile(&mut (*cursor).pixel_hash, 0);
    }
    for index in 0..6 {
        unsafe { write_volatile(&mut (*cursor).reserved[index], 0) };
    }
    for index in 0..CURSOR_WORDS {
        unsafe { write_volatile(&mut (*cursor).pixels[index as usize], 0) };
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
    {
        return 0;
    }
    let layout = unsafe { read_volatile(config_ptr as *const Layout) };
    if layout.player_chat_message == 0
        || layout.hide_hero_panel_message == 0
        || layout.show_hero_panel_message == 0
        || layout.hide_hero_panel_message == layout.show_hero_panel_message
    {
        return 0;
    }
    unsafe {
        SNAPSHOT_PTR = snapshot_ptr;
        CURSOR_PTR = cursor_ptr;
        TOOLBOX_PTR = toolbox_ptr;
        LAYOUT = layout;
        FEATURES = features;
        INITIALIZED = true;
        TICK_COUNT = 0;
        SEQUENCE = 0;
        CURSOR_SEQUENCE = 0;
        CURSOR_GENERATION = 0;
        CURSOR_PUBLISHED = CursorPublished::EMPTY;
        CURSOR_DIRTY = true;
        CURSOR_EVENT_COUNT = 0;
        TOOLBOX_SEQUENCE = 0;
        PLAYER_CHAT_COUNT = 0;
        HERO_COUNT = 0;
        FIRST_HERO_ID = 0;
        FIRST_HERO_AGENT_ID = 0;
        PANEL_STATE = PANEL_UNKNOWN;
        PANEL_PENDING = PANEL_UNKNOWN;
        COMMAND_REQUEST = 0;
        COMMAND_COMPLETE = 0;
        COMMAND_STATUS = COMMAND_IDLE;
        if features & FEATURE_TARGET_READOUT != 0 {
            publish(State::empty());
        }
        if features & FEATURE_NATIVE_CURSOR != 0 {
            clear_cursor();
            publish_cursor(CursorPublished::EMPTY, None);
        }
        if features & FEATURE_TOOLBOX_FOUNDATION != 0 {
            let words = TOOLBOX_BYTES / 4;
            for index in 0..words {
                write_volatile((toolbox_ptr + index * 4) as *mut u32, 0);
            }
            publish_toolbox();
        }
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn companion_dispatch(
    kind: u32,
    a: u32,
    b: u32,
    c: u32,
    d: u32,
    e: u32,
) {
    match kind {
        DISPATCH_TICK => {
            unsafe { tick_original(a) };
            if !unsafe { INITIALIZED } {
                return;
            }
            let features = unsafe { FEATURES };
            let layout = unsafe { LAYOUT };
            let state = if features & (FEATURE_TARGET_READOUT | FEATURE_TOOLBOX_FOUNDATION) != 0 {
                unsafe { collect(layout) }
            } else {
                State::empty()
            };
            if features & FEATURE_TARGET_READOUT != 0 {
                unsafe {
                    TICK_COUNT = TICK_COUNT.wrapping_add(1);
                    publish(state);
                }
            }
            if features & FEATURE_TOOLBOX_FOUNDATION != 0 {
                unsafe { tick_foundation(layout, state) };
            }
            if features & FEATURE_NATIVE_CURSOR != 0 {
                unsafe { tick_cursor(layout) };
            }
        }
        DISPATCH_CURSOR => {
            unsafe { cursor_original(a, b, c, d, e) };
            if unsafe { INITIALIZED } && unsafe { FEATURES } & FEATURE_NATIVE_CURSOR != 0 {
                unsafe {
                    CURSOR_EVENT_COUNT = CURSOR_EVENT_COUNT.saturating_add(1);
                    CURSOR_DIRTY = true;
                    if FEATURES & FEATURE_TOOLBOX_FOUNDATION != 0 {
                        publish_toolbox();
                    }
                }
            }
        }
        DISPATCH_UI => {
            unsafe { ui_original(a, b, c) };
            if !unsafe { INITIALIZED }
                || unsafe { FEATURES } & FEATURE_TOOLBOX_FOUNDATION == 0
            {
                return;
            }
            unsafe {
                let layout = LAYOUT;
                if a == layout.player_chat_message {
                    PLAYER_CHAT_COUNT = PLAYER_CHAT_COUNT.saturating_add(1);
                } else if b == FIRST_HERO_ID && a == layout.hide_hero_panel_message {
                    PANEL_STATE = PANEL_HIDDEN;
                } else if b == FIRST_HERO_ID && a == layout.show_hero_panel_message {
                    PANEL_STATE = PANEL_SHOWN;
                }
                publish_toolbox();
            }
        }
        _ => {}
    }
}

#[no_mangle]
pub unsafe extern "C" fn companion_set_first_hero_panel(shown: u32) -> u32 {
    if !unsafe { INITIALIZED }
        || unsafe { FEATURES } & FEATURE_TOOLBOX_FOUNDATION == 0
        || shown > 1
        || unsafe { PANEL_PENDING } != PANEL_UNKNOWN
    {
        return 0;
    }
    let mut request = unsafe { COMMAND_REQUEST }.wrapping_add(1);
    if request == 0 {
        request = 1;
    }
    unsafe {
        COMMAND_REQUEST = request;
        COMMAND_STATUS = COMMAND_IDLE;
        PANEL_PENDING = if shown == 1 { PANEL_SHOWN } else { PANEL_HIDDEN };
        publish_toolbox();
    }
    request
}

#[no_mangle]
pub extern "C" fn companion_abi() -> u32 {
    2
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
pub unsafe extern "C" fn companion_cursor_event_count() -> u32 {
    if unsafe { INITIALIZED } {
        unsafe { CURSOR_EVENT_COUNT }
    } else {
        0
    }
}
