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
const FEATURE_TEAM_MANAGEMENT: u32 = 1 << 2;
const KNOWN_FEATURES: u32 =
    FEATURE_NATIVE_CURSOR | FEATURE_TARGET_READOUT | FEATURE_TEAM_MANAGEMENT;

const TEAM_BYTES: u32 = size_of::<TeamSnapshot>() as u32;
const TEAM_MAGIC: u32 = 0x4d54_5747;
const TEAM_ABI_AND_SIZE: u32 = (TEAM_BYTES << 16) | 5;
const FLAG_TEAM_READY: u32 = 1 << 0;
const FLAG_TEAM_HARD_MODE: u32 = 1 << 1;
const MAX_OWNED_HEROES: usize = 7;
const MAX_TEAM_MEMBERS: usize = MAX_OWNED_HEROES + 1;
const MAX_BUILD_ATTRIBUTES: usize = 12;
const SKILL_SLOTS: usize = 8;
const PLAYER_BEHAVIOR: u32 = u32::MAX;
const AREA_INFO_COUNT: u32 = 888;
const AREA_INFO_STRIDE: u32 = 124;
const AREA_INFO_FLAGS: u32 = 0x10;
const AREA_INFO_MAX_PARTY_SIZE: u32 = 0x1c;
const AREA_FLAG_PVP: u32 = 0x40001;
const AREA_FLAG_GUILD_HALL: u32 = 0x800000;
const PARTY_CONTEXT_FLAGS: u32 = 0x14;
const PARTY_FLAG_HARD_MODE: u32 = 0x10;
const TEAM_PLAN_BYTES: u32 = size_of::<DesiredTeam>() as u32;
const COMMAND_RUNNING: u32 = 1;
const COMMAND_COMPLETE: u32 = 2;
const COMMAND_FAILED: u32 = 3;
const COMMAND_WARNING_SKILLS_SKIPPED: u32 = 1 << 0;
const PHASE_ROSTER_REMOVE: u32 = 1;
const PHASE_WAIT_ROSTER_REMOVE: u32 = 2;
const PHASE_ROSTER_ADD: u32 = 3;
const PHASE_WAIT_ROSTER_ADD: u32 = 4;
const PHASE_DIFFICULTY: u32 = 5;
const PHASE_WAIT_DIFFICULTY: u32 = 6;
const PHASE_PROFESSION: u32 = 7;
const PHASE_WAIT_PROFESSION: u32 = 8;
const PHASE_ATTRIBUTES: u32 = 9;
const PHASE_WAIT_ATTRIBUTES: u32 = 10;
const PHASE_SKILLS: u32 = 11;
const PHASE_WAIT_SKILLS: u32 = 12;
const PHASE_BEHAVIOR: u32 = 13;
const PHASE_WAIT_BEHAVIOR: u32 = 14;
const PHASE_DISABLED_SKILLS: u32 = 15;
const PHASE_WAIT_DISABLED_SKILL: u32 = 16;
const PHASE_PANEL: u32 = 17;
const PHASE_VERIFY: u32 = 18;
const PHASE_DONE: u32 = 19;
const ERROR_GAME_UNAVAILABLE: u32 = 1;
const ERROR_NOT_SAFE_OUTPOST: u32 = 2;
const ERROR_PRIMARY_MISMATCH: u32 = 3;
const ERROR_TIMEOUT: u32 = 4;
const ERROR_MEMBER_MISSING: u32 = 5;
const ERROR_HERO_UNAVAILABLE: u32 = 6;
const ERROR_PARTY_CAPACITY: u32 = 7;
const ACK_TIMEOUT_TICKS: u32 = 300;
// Guild Wars updates the local view before the server can reject a template.
// A half-second of identical readback distinguishes that echo from an
// authoritative result without adding a second acknowledgement channel.
const ACK_SETTLE_TICKS: u32 = 30;
const FINAL_SETTLE_TICKS: u32 = ACK_TIMEOUT_TICKS;

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
    area_info_base: u32,
    player_number: u32,
    party_context: u32,
    player_party: u32,
    party_heroes: u32,
    hero_member_stride: u32,
    hero_agent_id: u32,
    hero_owner_player_id: u32,
    hero_id: u32,
    world_context: u32,
    world_attributes: u32,
    party_attribute_stride: u32,
    party_attribute_agent_id: u32,
    party_attribute_values: u32,
    attribute_stride: u32,
    attribute_id: u32,
    attribute_base_rank: u32,
    world_hero_flags: u32,
    hero_flag_stride: u32,
    hero_flag_hero_id: u32,
    hero_flag_agent_id: u32,
    hero_flag_behavior: u32,
    world_profession_states: u32,
    profession_state_stride: u32,
    profession_state_agent_id: u32,
    profession_state_primary: u32,
    profession_state_secondary: u32,
    world_skillbars: u32,
    skillbar_stride: u32,
    skillbar_agent_id: u32,
    skillbar_skills: u32,
    skill_stride: u32,
    skill_id: u32,
    skillbar_disabled: u32,
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
    party_players: u32,
    player_member_stride: u32,
    party_henchmen: u32,
    henchman_member_stride: u32,
    hero_member_level: u32,
    world_hero_info: u32,
    hero_info_stride: u32,
    hero_info_hero_id: u32,
    hero_info_level: u32,
    hero_info_primary: u32,
    hero_info_secondary: u32,
    agent_level: u32,
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

#[repr(C)]
#[derive(Clone, Copy)]
struct TeamMemberSnapshot {
    agent_id: u32,
    hero_id: u32,
    primary: u32,
    secondary: u32,
    behavior: u32,
    disabled_skills: u32,
    attribute_count: u32,
    level: u32,
    attribute_ids: [u32; MAX_BUILD_ATTRIBUTES],
    attribute_ranks: [u32; MAX_BUILD_ATTRIBUTES],
    skills: [u32; SKILL_SLOTS],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct TeamSnapshot {
    magic: u32,
    abi_and_size: u32,
    sequence: u32,
    flags: u32,
    tick_count: u32,
    member_count: u32,
    command_id: u32,
    command_status: u32,
    command_phase: u32,
    command_completed_steps: u32,
    command_error: u32,
    command_warnings: u32,
    members: [TeamMemberSnapshot; MAX_TEAM_MEMBERS],
}

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
struct DesiredMember {
    hero_id: u32,
    apply_build: u32,
    primary: u32,
    secondary: u32,
    behavior: u32,
    disabled_skills: u32,
    attribute_count: u32,
    panel: u32,
    attribute_ids: [u32; MAX_BUILD_ATTRIBUTES],
    attribute_ranks: [u32; MAX_BUILD_ATTRIBUTES],
    skills: [u32; SKILL_SLOTS],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct DesiredTeam {
    member_count: u32,
    mode: u32,
    reserved: [u32; 2],
    members: [DesiredMember; MAX_TEAM_MEMBERS],
}

#[derive(Clone, Copy)]
struct TeamCommand {
    id: u32,
    status: u32,
    phase: u32,
    completed_steps: u32,
    error: u32,
    warnings: u32,
    mode: u32,
    member_count: u32,
    member_index: u32,
    wait_started: u32,
    wait_value: u32,
    wait_hash: u32,
    wait_stable_ticks: u32,
    members: [DesiredMember; MAX_TEAM_MEMBERS],
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

const _: [(); 296] = [(); size_of::<Layout>()];
const _: [(); 64] = [(); size_of::<Snapshot>()];
const _: [(); 160] = [(); size_of::<TeamMemberSnapshot>()];
const _: [(); 1328] = [(); size_of::<TeamSnapshot>()];
const _: [(); 160] = [(); size_of::<DesiredMember>()];
const _: [(); 1296] = [(); size_of::<DesiredTeam>()];
const _: [(); 4160] = [(); size_of::<CursorSnapshot>()];

#[link(wasm_import_module = "env")]
extern "C" {
    // The host allocates this state inside Guild Wars' own heap. Keeping only
    // the imported-memory pointer out of this module avoids fixed data segments
    // at Rust's default 1 MiB global base.
    fn enhancement_kernel_state() -> u32;
}

#[link(wasm_import_module = "game")]
extern "C" {
    #[link_name = "enhancement_tick_original"]
    fn tick_original(context: u32);
    #[link_name = "enhancement_hero_add"]
    fn add_hero(hero_id: u32);
    #[link_name = "enhancement_hero_kick"]
    fn kick_hero(hero_id: u32);
    #[link_name = "enhancement_difficulty"]
    fn set_difficulty(hard_mode: u32);
    #[link_name = "enhancement_secondary_profession"]
    fn set_secondary_profession(agent_id: u32, profession_id: u32);
    #[link_name = "enhancement_attributes"]
    fn set_attributes(agent_id: u32, count: u32, ids: u32, ranks: u32);
    #[link_name = "enhancement_skillbar"]
    fn set_skillbar(agent_id: u32, count: u32, skills: u32);
    #[link_name = "enhancement_hero_behavior"]
    fn set_hero_behavior(agent_id: u32, behavior: u32);
    #[link_name = "enhancement_hero_skill_toggle"]
    fn toggle_hero_skill(agent_id: u32, slot: u32);
    #[link_name = "enhancement_hero_panel"]
    fn set_hero_panel(hero_id: u32, visible: u32);
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

fn field_fits(field: u32, bytes: u32, stride: u32) -> bool {
    checked_add(field, bytes).is_some_and(|end| end <= stride)
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

unsafe fn read_u8(address: u32) -> Option<u8> {
    contains(address, 1).then(|| unsafe { read_volatile(address as *const u8) })
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
    level: u32,
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
            level: 0,
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

unsafe fn read_agent(layout: Layout, agent_buffer: u32, size: u32, id: u32) -> Option<AgentState> {
    if id == 0 || id >= size {
        return None;
    }
    let entry = indexed(agent_buffer, id, 4)?;
    let required = checked_add(layout.agent_level, 1)?.max(0x100);
    let address = unsafe { pointer(entry, required)? };
    if unsafe { read_u32(offset(address, layout.agent_id)?)? } != id {
        return None;
    }
    let kind = unsafe { read_u32(offset(address, layout.agent_type)?)? };
    let level = unsafe { read_u8(offset(address, layout.agent_level)?)? } as u32;
    let x = unsafe { read_f32(offset(address, layout.agent_x)?)? };
    let y = unsafe { read_f32(offset(address, layout.agent_y)?)? };
    if !valid_agent_type(kind)
        || !(1..=20).contains(&level)
        || !finite_position(x)
        || !finite_position(y)
    {
        return None;
    }
    Some(AgentState {
        id,
        kind,
        level,
        x,
        y,
    })
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

    let read_character =
        |field| offset(character, field).and_then(|address| unsafe { read_u32(address) });
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

    if layout.manual_target_agent_id != 0 && layout.automatic_target_agent_id != 0 {
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

#[derive(Clone, Copy)]
struct RosterState {
    ready: bool,
    party_size: u32,
    hero_count: u32,
    hero_ids: [u32; MAX_OWNED_HEROES],
    hero_agent_ids: [u32; MAX_OWNED_HEROES],
    hero_levels: [u32; MAX_OWNED_HEROES],
}

fn empty_roster() -> RosterState {
    // Every field is an integer, boolean, or integer array, so all-zero is a
    // valid unavailable state without a large literal data segment.
    unsafe { core::mem::zeroed() }
}

unsafe fn collect_roster(layout: Layout, state: State) -> RosterState {
    if state.flags & (FLAG_READY | FLAG_PLAYER_VALID) != (FLAG_READY | FLAG_PLAYER_VALID)
        || state.game == 0
        || state.player_number == 0
        || layout.hero_member_stride < 12
        || layout.hero_member_stride > 64
        || layout.hero_agent_id + 4 > layout.hero_member_stride
        || layout.hero_owner_player_id + 4 > layout.hero_member_stride
        || layout.hero_id + 4 > layout.hero_member_stride
        || layout.hero_member_level + 4 > layout.hero_member_stride
        || layout.player_member_stride != 0x0c
        || layout.henchman_member_stride != 0x34
    {
        return empty_roster();
    }
    let Some(party_bytes) = checked_add(layout.player_party, 4) else {
        return empty_roster();
    };
    let Some(party_info_bytes) = checked_add(
        layout
            .party_players
            .max(layout.party_henchmen)
            .max(layout.party_heroes),
        12,
    ) else {
        return empty_roster();
    };
    let party = match offset(state.game, layout.party_context)
        .and_then(|address| unsafe { pointer(address, party_bytes) })
    {
        Some(value) => value,
        None => return empty_roster(),
    };
    let party_info = match offset(party, layout.player_party)
        .and_then(|address| unsafe { pointer(address, party_info_bytes) })
    {
        Some(value) => value,
        None => return empty_roster(),
    };
    let players = match unsafe {
        read_array(
            party_info,
            layout.party_players,
            layout.player_member_stride,
            64,
        )
    } {
        Some(value) => value,
        None => return empty_roster(),
    };
    let henchmen = match unsafe {
        read_array(
            party_info,
            layout.party_henchmen,
            layout.henchman_member_stride,
            64,
        )
    } {
        Some(value) => value,
        None => return empty_roster(),
    };
    let heroes = match unsafe {
        read_array(
            party_info,
            layout.party_heroes,
            layout.hero_member_stride,
            64,
        )
    } {
        Some(value) => value,
        _ => return empty_roster(),
    };
    let Some(party_size) = players
        .size
        .checked_add(henchmen.size)
        .and_then(|size| size.checked_add(heroes.size))
    else {
        return empty_roster();
    };
    if party_size == 0 || party_size > 64 {
        return empty_roster();
    }

    let mut result = RosterState {
        ready: true,
        party_size,
        ..empty_roster()
    };
    for index in 0..heroes.size {
        let Some(member) = indexed(heroes.buffer, index, layout.hero_member_stride) else {
            return empty_roster();
        };
        let Some(owner) =
            offset(member, layout.hero_owner_player_id).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_roster();
        };
        let Some(hero_id) = offset(member, layout.hero_id).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_roster();
        };
        let Some(agent_id) =
            offset(member, layout.hero_agent_id).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_roster();
        };
        let Some(level) =
            offset(member, layout.hero_member_level).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_roster();
        };
        if !(1..=39).contains(&hero_id) {
            return empty_roster();
        }
        if owner != state.player_number {
            continue;
        }
        let used = result.hero_count as usize;
        if used >= MAX_OWNED_HEROES
            || result.hero_ids[..used].contains(&hero_id)
            || agent_id == 0
            || result.hero_agent_ids[..used].contains(&agent_id)
            || !(1..=20).contains(&level)
        {
            return empty_roster();
        }
        result.hero_ids[used] = hero_id;
        result.hero_agent_ids[used] = agent_id;
        result.hero_levels[used] = level;
        result.hero_count += 1;
    }
    result
}

#[derive(Clone, Copy)]
struct ArrayView {
    buffer: u32,
    size: u32,
    stride: u32,
}

unsafe fn read_array(owner: u32, field: u32, stride: u32, max_capacity: u32) -> Option<ArrayView> {
    if stride < 4 || stride > 2_048 {
        return None;
    }
    let array = offset(owner, field)?;
    if !contains(array, 12) {
        return None;
    }
    let buffer = unsafe { read_u32(array)? };
    let capacity = unsafe { read_u32(offset(array, 4)?)? };
    let size = unsafe { read_u32(offset(array, 8)?)? };
    if size > capacity || capacity > max_capacity {
        return None;
    }
    if size > 0 {
        let bytes = checked_mul(size, stride)?;
        if buffer == 0 || buffer & 3 != 0 || !contains(buffer, bytes) {
            return None;
        }
    }
    Some(ArrayView {
        buffer,
        size,
        stride,
    })
}

unsafe fn find_unique_by_u32(array: ArrayView, field: u32, value: u32) -> Option<u32> {
    if field + 4 > array.stride {
        return None;
    }
    let mut found = None;
    for index in 0..array.size {
        let record = indexed(array.buffer, index, array.stride)?;
        if unsafe { read_u32(offset(record, field)?)? } != value {
            continue;
        }
        if found.is_some() {
            return None;
        }
        found = Some(record);
    }
    found
}

fn valid_professions(primary: u32, secondary: u32) -> bool {
    (1..=10).contains(&primary) && secondary <= 10 && secondary != primary
}

fn valid_attribute_id(id: u32) -> bool {
    id <= 44 && !(26..=28).contains(&id)
}

fn desired_member_is_empty(member: &DesiredMember) -> bool {
    member.hero_id == 0
        && member.apply_build == 0
        && member.primary == 0
        && member.secondary == 0
        && member.behavior == 0
        && member.disabled_skills == 0
        && member.attribute_count == 0
        && member.panel == 0
        && member.attribute_ids.iter().all(|value| *value == 0)
        && member.attribute_ranks.iter().all(|value| *value == 0)
        && member.skills.iter().all(|value| *value == 0)
}

unsafe fn read_team_member(
    layout: Layout,
    attributes: ArrayView,
    hero_flags: ArrayView,
    professions: ArrayView,
    skillbars: ArrayView,
    agent_id: u32,
    hero_id: u32,
) -> Option<TeamMemberSnapshot> {
    let profession =
        unsafe { find_unique_by_u32(professions, layout.profession_state_agent_id, agent_id)? };
    let primary = unsafe { read_u32(offset(profession, layout.profession_state_primary)?)? };
    let secondary = unsafe { read_u32(offset(profession, layout.profession_state_secondary)?)? };
    if !valid_professions(primary, secondary) {
        return None;
    }

    let skillbar = unsafe { find_unique_by_u32(skillbars, layout.skillbar_agent_id, agent_id)? };
    let disabled_skills = unsafe { read_u32(offset(skillbar, layout.skillbar_disabled)?)? };
    if disabled_skills & !0xff != 0 {
        return None;
    }
    let mut skills = [0; SKILL_SLOTS];
    for (slot, value) in skills.iter_mut().enumerate() {
        let skill = indexed(
            offset(skillbar, layout.skillbar_skills)?,
            slot as u32,
            layout.skill_stride,
        )?;
        *value = unsafe { read_u32(offset(skill, layout.skill_id)?)? };
    }

    let party_attribute =
        unsafe { find_unique_by_u32(attributes, layout.party_attribute_agent_id, agent_id)? };
    let mut attribute_ids = [0; MAX_BUILD_ATTRIBUTES];
    let mut attribute_ranks = [0; MAX_BUILD_ATTRIBUTES];
    let mut attribute_count = 0usize;
    let values = offset(party_attribute, layout.party_attribute_values)?;
    for index in 0..54 {
        let attribute = indexed(values, index, layout.attribute_stride)?;
        let rank = unsafe { read_u32(offset(attribute, layout.attribute_base_rank)?)? };
        if rank == 0 {
            continue;
        }
        let id = unsafe { read_u32(offset(attribute, layout.attribute_id)?)? };
        if rank > 12
            || !valid_attribute_id(id)
            || attribute_count >= MAX_BUILD_ATTRIBUTES
            || attribute_ids[..attribute_count].contains(&id)
        {
            return None;
        }
        attribute_ids[attribute_count] = id;
        attribute_ranks[attribute_count] = rank;
        attribute_count += 1;
    }

    let behavior = if hero_id == 0 {
        PLAYER_BEHAVIOR
    } else {
        let flag = unsafe { find_unique_by_u32(hero_flags, layout.hero_flag_agent_id, agent_id)? };
        if unsafe { read_u32(offset(flag, layout.hero_flag_hero_id)?)? } != hero_id {
            return None;
        }
        let value = unsafe { read_u32(offset(flag, layout.hero_flag_behavior)?)? };
        if value > 2 {
            return None;
        }
        value
    };

    Some(TeamMemberSnapshot {
        agent_id,
        hero_id,
        primary,
        secondary,
        behavior,
        disabled_skills,
        attribute_count: attribute_count as u32,
        level: 0,
        attribute_ids,
        attribute_ranks,
        skills,
    })
}

#[derive(Clone, Copy)]
struct TeamState {
    flags: u32,
    member_count: u32,
    party_size: u32,
    max_party_size: u32,
    available_heroes: [u32; 40],
    hero_levels: [u32; 40],
    hero_primary: [u32; 40],
    members: [TeamMemberSnapshot; MAX_TEAM_MEMBERS],
}

fn empty_team() -> TeamState {
    // See `empty_roster`: this avoids materializing almost 2 KiB at Rust's
    // otherwise fixed global base inside the imported game memory.
    unsafe { core::mem::zeroed() }
}

unsafe fn collect_team(layout: Layout, state: State, roster: RosterState) -> TeamState {
    if !roster.ready
        || state.flags & (FLAG_READY | FLAG_PLAYER_VALID) != (FLAG_READY | FLAG_PLAYER_VALID)
        || state.game == 0
        || state.player.id == 0
    {
        return empty_team();
    }
    if !field_fits(
        layout.party_attribute_agent_id,
        4,
        layout.party_attribute_stride,
    ) || !checked_mul(54, layout.attribute_stride).is_some_and(|bytes| {
        field_fits(
            layout.party_attribute_values,
            bytes,
            layout.party_attribute_stride,
        )
    }) || !field_fits(layout.attribute_id, 4, layout.attribute_stride)
        || !field_fits(layout.attribute_base_rank, 4, layout.attribute_stride)
        || !field_fits(layout.hero_flag_agent_id, 4, layout.hero_flag_stride)
        || !field_fits(layout.hero_flag_hero_id, 4, layout.hero_flag_stride)
        || !field_fits(layout.hero_flag_behavior, 4, layout.hero_flag_stride)
        || !field_fits(
            layout.profession_state_agent_id,
            4,
            layout.profession_state_stride,
        )
        || !field_fits(
            layout.profession_state_primary,
            4,
            layout.profession_state_stride,
        )
        || !field_fits(
            layout.profession_state_secondary,
            4,
            layout.profession_state_stride,
        )
        || !field_fits(layout.skillbar_agent_id, 4, layout.skillbar_stride)
        || !field_fits(layout.skillbar_disabled, 4, layout.skillbar_stride)
        || !checked_mul(SKILL_SLOTS as u32, layout.skill_stride)
            .is_some_and(|bytes| field_fits(layout.skillbar_skills, bytes, layout.skillbar_stride))
        || !field_fits(layout.skill_id, 4, layout.skill_stride)
        || !field_fits(layout.hero_info_hero_id, 4, layout.hero_info_stride)
        || !field_fits(layout.hero_info_level, 4, layout.hero_info_stride)
        || !field_fits(layout.hero_info_primary, 4, layout.hero_info_stride)
        || !field_fits(layout.hero_info_secondary, 4, layout.hero_info_stride)
    {
        return empty_team();
    }
    let world = match offset(state.game, layout.world_context)
        .and_then(|address| unsafe { pointer(address, 12) })
    {
        Some(value) => value,
        None => return empty_team(),
    };
    let attributes = match unsafe {
        read_array(
            world,
            layout.world_attributes,
            layout.party_attribute_stride,
            64,
        )
    } {
        Some(value) => value,
        None => return empty_team(),
    };
    let hero_flags =
        match unsafe { read_array(world, layout.world_hero_flags, layout.hero_flag_stride, 64) } {
            Some(value) => value,
            None => return empty_team(),
        };
    let professions = match unsafe {
        read_array(
            world,
            layout.world_profession_states,
            layout.profession_state_stride,
            64,
        )
    } {
        Some(value) => value,
        None => return empty_team(),
    };
    let skillbars =
        match unsafe { read_array(world, layout.world_skillbars, layout.skillbar_stride, 64) } {
            Some(value) => value,
            None => return empty_team(),
        };
    let hero_info =
        match unsafe { read_array(world, layout.world_hero_info, layout.hero_info_stride, 64) } {
            Some(value) if value.size > 0 => value,
            _ => return empty_team(),
        };
    let party = match offset(state.game, layout.party_context)
        .and_then(|address| unsafe { pointer(address, PARTY_CONTEXT_FLAGS + 4) })
    {
        Some(value) => value,
        None => return empty_team(),
    };
    let Some(party_flags) =
        offset(party, PARTY_CONTEXT_FLAGS).and_then(|address| unsafe { read_u32(address) })
    else {
        return empty_team();
    };

    if state.map_id >= AREA_INFO_COUNT {
        return empty_team();
    }
    let Some(area_record) = indexed(layout.area_info_base, state.map_id, AREA_INFO_STRIDE) else {
        return empty_team();
    };
    let Some(max_party_size) = offset(area_record, AREA_INFO_MAX_PARTY_SIZE)
        .and_then(|address| unsafe { read_u32(address) })
        .filter(|size| (1..=12).contains(size))
    else {
        return empty_team();
    };

    let mut result = TeamState {
        flags: FLAG_TEAM_READY
            | if party_flags & PARTY_FLAG_HARD_MODE != 0 {
                FLAG_TEAM_HARD_MODE
            } else {
                0
        },
        party_size: roster.party_size,
        max_party_size,
        ..empty_team()
    };
    for index in 0..hero_info.size {
        let Some(record) = indexed(hero_info.buffer, index, hero_info.stride) else {
            return empty_team();
        };
        let Some(hero_id) =
            offset(record, layout.hero_info_hero_id).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_team();
        };
        let Some(level) =
            offset(record, layout.hero_info_level).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_team();
        };
        let Some(primary) =
            offset(record, layout.hero_info_primary).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_team();
        };
        let Some(secondary) =
            offset(record, layout.hero_info_secondary).and_then(|at| unsafe { read_u32(at) })
        else {
            return empty_team();
        };
        if !(1..=39).contains(&hero_id)
            || !(1..=20).contains(&level)
            || !valid_professions(primary, secondary)
        {
            return empty_team();
        }
        let slot = hero_id as usize;
        if result.available_heroes[slot] != 0 {
            return empty_team();
        }
        // Toolbox needs the mercenary name to distinguish an assigned clone
        // from the current player's unassigned slot. This boundary exports no
        // names, so an absent mercenary fails closed. A mercenary already in
        // our party is authoritative evidence that this slot is available.
        let mercenary = (28..=35).contains(&hero_id);
        let present = roster.hero_ids[..roster.hero_count as usize].contains(&hero_id);
        result.available_heroes[slot] = u32::from(!mercenary || present);
        result.hero_levels[slot] = level;
        result.hero_primary[slot] = primary;
    }
    for index in 0..roster.hero_count as usize {
        let hero_id = roster.hero_ids[index] as usize;
        if result.available_heroes[hero_id] == 0
            || result.hero_levels[hero_id] != roster.hero_levels[index]
        {
            return empty_team();
        }
    }
    let Some(player) = (unsafe {
        read_team_member(
            layout,
            attributes,
            hero_flags,
            professions,
            skillbars,
            state.player.id,
            0,
        )
    }) else {
        return empty_team();
    };
    result.members[0] = TeamMemberSnapshot {
        level: state.player.level,
        ..player
    };
    result.member_count = 1;
    for index in 0..roster.hero_count as usize {
        let Some(member) = (unsafe {
            read_team_member(
                layout,
                attributes,
                hero_flags,
                professions,
                skillbars,
                roster.hero_agent_ids[index],
                roster.hero_ids[index],
            )
        }) else {
            return empty_team();
        };
        result.members[index + 1] = TeamMemberSnapshot {
            level: roster.hero_levels[index],
            ..member
        };
        result.member_count += 1;
    }
    result
}

fn attributes_match(member: TeamMemberSnapshot, desired: DesiredMember) -> bool {
    if member.attribute_count != desired.attribute_count {
        return false;
    }
    for index in 0..desired.attribute_count as usize {
        if member.attribute_ids[index] != desired.attribute_ids[index]
            || member.attribute_ranks[index] != desired.attribute_ranks[index]
        {
            return false;
        }
    }
    true
}

fn skills_match(member: TeamMemberSnapshot, desired: DesiredMember) -> bool {
    member.skills == desired.skills
}

fn normalized_skills(
    member: TeamMemberSnapshot,
    desired: DesiredMember,
) -> Option<bool> {
    let mut skipped = false;
    for index in 0..SKILL_SLOTS {
        let actual = member.skills[index];
        let requested = desired.skills[index];
        if actual == requested {
            continue;
        }
        if requested != 0 && actual == 0 {
            skipped = true;
            continue;
        }
        return None;
    }
    Some(skipped)
}

fn skillbar_hash(skills: [u32; SKILL_SLOTS]) -> u32 {
    let mut hash = 0x811c_9dc5u32;
    for skill in skills {
        hash = (hash ^ skill).wrapping_mul(0x0100_0193);
    }
    hash
}

fn attribute_hash(member: TeamMemberSnapshot) -> u32 {
    let mut hash = (0x811c_9dc5u32 ^ member.attribute_count)
        .wrapping_mul(0x0100_0193);
    for index in 0..member.attribute_count as usize {
        hash = (hash ^ member.attribute_ids[index]).wrapping_mul(0x0100_0193);
        hash = (hash ^ member.attribute_ranks[index]).wrapping_mul(0x0100_0193);
    }
    hash
}

unsafe fn pve_non_guild_hall(layout: Layout, map_id: u32) -> bool {
    if map_id >= AREA_INFO_COUNT {
        return false;
    }
    let Some(record) = indexed(layout.area_info_base, map_id, AREA_INFO_STRIDE) else {
        return false;
    };
    let Some(flags_address) = offset(record, AREA_INFO_FLAGS) else {
        return false;
    };
    let Some(flags) = (unsafe { read_u32(flags_address) }) else {
        return false;
    };
    flags & (AREA_FLAG_PVP | AREA_FLAG_GUILD_HALL) == 0
}

fn fail_command(kernel: &mut KernelState, error: u32) {
    kernel.command.status = COMMAND_FAILED;
    kernel.command.error = error;
}

fn desired_contains(command: TeamCommand, hero_id: u32) -> bool {
    command.members[1..command.member_count as usize]
        .iter()
        .any(|member| member.hero_id == hero_id)
}

fn live_member(team: TeamState, desired: DesiredMember) -> Option<TeamMemberSnapshot> {
    team.members[..team.member_count as usize]
        .iter()
        .copied()
        .find(|member| member.hero_id == desired.hero_id)
}

fn advance_member(command: &mut TeamCommand) {
    command.member_index += 1;
    if command.member_index >= command.member_count {
        command.phase = PHASE_VERIFY;
        command.wait_value = 0;
        command.wait_stable_ticks = 0;
    } else {
        command.phase = PHASE_PROFESSION;
    }
}

fn team_matches(command: TeamCommand, team: TeamState) -> bool {
    if team.member_count != command.member_count {
        return false;
    }
    if command.mode != 0
        && (team.flags & FLAG_TEAM_HARD_MODE != 0) != (command.mode == 2)
    {
        return false;
    }
    for desired in &command.members[..command.member_count as usize] {
        let Some(member) = live_member(team, *desired) else {
            return false;
        };
        if desired.apply_build == 1
            && (member.primary != desired.primary
                || member.secondary != desired.secondary
                || !attributes_match(member, *desired)
                || normalized_skills(member, *desired).is_none())
        {
            return false;
        }
        if desired.hero_id != 0
            && (member.behavior != desired.behavior
                || member.disabled_skills != desired.disabled_skills)
        {
            return false;
        }
    }
    true
}

fn preflight_team(
    command: TeamCommand,
    team: TeamState,
) -> Result<(), u32> {
    let current_owned = team.member_count.checked_sub(1).ok_or(ERROR_GAME_UNAVAILABLE)?;
    let fixed_members = team
        .party_size
        .checked_sub(current_owned)
        .ok_or(ERROR_GAME_UNAVAILABLE)?;
    let desired_owned = command
        .member_count
        .checked_sub(1)
        .ok_or(ERROR_GAME_UNAVAILABLE)?;
    let final_party_size = fixed_members
        .checked_add(desired_owned)
        .ok_or(ERROR_PARTY_CAPACITY)?;
    if final_party_size > team.max_party_size {
        return Err(ERROR_PARTY_CAPACITY);
    }

    let player = command.members[0];
    if player.apply_build != 0 {
        if team.members[0].primary != player.primary {
            return Err(ERROR_PRIMARY_MISMATCH);
        }
    }

    for desired in &command.members[1..command.member_count as usize] {
        let hero_id = desired.hero_id as usize;
        if hero_id >= team.available_heroes.len() || team.available_heroes[hero_id] == 0 {
            return Err(ERROR_HERO_UNAVAILABLE);
        }
        if desired.apply_build != 0 {
            if team.hero_primary[hero_id] != desired.primary {
                return Err(ERROR_PRIMARY_MISMATCH);
            }
        }
    }
    Ok(())
}

unsafe fn reconcile_team(
    layout: Layout,
    state: State,
    team: TeamState,
    kernel: &mut KernelState,
) {
    let mut command = kernel.command;
    if command.status != COMMAND_RUNNING {
        return;
    }
    if state.flags & (FLAG_READY | FLAG_PLAYER_VALID) != (FLAG_READY | FLAG_PLAYER_VALID) {
        fail_command(kernel, ERROR_GAME_UNAVAILABLE);
        return;
    }
    if state.instance_type != 0 || !unsafe { pve_non_guild_hall(layout, state.map_id) } {
        fail_command(kernel, ERROR_NOT_SAFE_OUTPOST);
        return;
    }
    if team.flags & FLAG_TEAM_READY == 0 {
        fail_command(kernel, ERROR_GAME_UNAVAILABLE);
        return;
    }
    if command.phase == PHASE_ROSTER_REMOVE && command.completed_steps == 0 {
        if let Err(error) = preflight_team(command, team) {
            fail_command(kernel, error);
            return;
        }
    }

    loop {
        match command.phase {
            PHASE_ROSTER_REMOVE => {
                let unwanted = team.members[1..team.member_count as usize]
                    .iter()
                    .find(|member| !desired_contains(command, member.hero_id))
                    .map(|member| member.hero_id);
                let Some(hero_id) = unwanted else {
                    command.phase = PHASE_ROSTER_ADD;
                    kernel.command = command;
                    continue;
                };
                unsafe { kick_hero(hero_id) };
                command.phase = PHASE_WAIT_ROSTER_REMOVE;
                command.wait_started = kernel.tick_count;
                command.wait_value = hero_id;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_ROSTER_REMOVE => {
                if team.members[1..team.member_count as usize]
                    .iter()
                    .all(|member| member.hero_id != command.wait_value)
                {
                    command.completed_steps += 1;
                    command.phase = PHASE_ROSTER_REMOVE;
                    kernel.command = command;
                    continue;
                }
            }
            PHASE_ROSTER_ADD => {
                let missing = command.members[1..command.member_count as usize]
                    .iter()
                    .find(|desired| live_member(team, **desired).is_none())
                    .map(|desired| desired.hero_id);
                let Some(hero_id) = missing else {
                    command.member_index = 0;
                    command.phase = PHASE_DIFFICULTY;
                    kernel.command = command;
                    continue;
                };
                unsafe { add_hero(hero_id) };
                command.phase = PHASE_WAIT_ROSTER_ADD;
                command.wait_started = kernel.tick_count;
                command.wait_value = hero_id;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_ROSTER_ADD => {
                if team.members[1..team.member_count as usize]
                    .iter()
                    .any(|member| member.hero_id == command.wait_value)
                {
                    command.completed_steps += 1;
                    command.phase = PHASE_ROSTER_ADD;
                    kernel.command = command;
                    continue;
                }
            }
            PHASE_DIFFICULTY => {
                if command.mode == 0 {
                    command.phase = PHASE_PROFESSION;
                    kernel.command = command;
                    continue;
                }
                let hard_mode = team.flags & FLAG_TEAM_HARD_MODE != 0;
                let desired_hard_mode = command.mode == 2;
                if hard_mode == desired_hard_mode {
                    command.phase = PHASE_PROFESSION;
                    kernel.command = command;
                    continue;
                }
                unsafe { set_difficulty(u32::from(desired_hard_mode)) };
                command.phase = PHASE_WAIT_DIFFICULTY;
                command.wait_started = kernel.tick_count;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_DIFFICULTY => {
                let hard_mode = team.flags & FLAG_TEAM_HARD_MODE != 0;
                if hard_mode == (command.mode == 2) {
                    command.completed_steps += 1;
                    command.phase = PHASE_PROFESSION;
                    kernel.command = command;
                    continue;
                }
            }
            PHASE_PROFESSION => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if desired.apply_build == 0 {
                    command.phase = PHASE_BEHAVIOR;
                    kernel.command = command;
                    continue;
                }
                if member.primary != desired.primary {
                    fail_command(kernel, ERROR_PRIMARY_MISMATCH);
                    return;
                }
                if member.secondary == desired.secondary {
                    command.phase = PHASE_ATTRIBUTES;
                    kernel.command = command;
                    continue;
                }
                unsafe { set_secondary_profession(member.agent_id, desired.secondary) };
                command.phase = PHASE_WAIT_PROFESSION;
                command.wait_started = kernel.tick_count;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_PROFESSION => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if member.secondary == desired.secondary {
                    command.completed_steps += 1;
                    command.phase = PHASE_ATTRIBUTES;
                    kernel.command = command;
                    continue;
                }
            }
            PHASE_ATTRIBUTES => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if attributes_match(member, desired) {
                    command.phase = PHASE_SKILLS;
                    kernel.command = command;
                    continue;
                }
                let index = command.member_index as usize;
                kernel.command = command;
                let ids = core::ptr::addr_of!(kernel.command.members[index].attribute_ids) as u32;
                let ranks =
                    core::ptr::addr_of!(kernel.command.members[index].attribute_ranks) as u32;
                unsafe {
                    set_attributes(member.agent_id, desired.attribute_count, ids, ranks);
                }
                command.phase = PHASE_WAIT_ATTRIBUTES;
                command.wait_started = kernel.tick_count;
                command.wait_hash = 0;
                command.wait_stable_ticks = 0;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_ATTRIBUTES => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if attributes_match(member, desired) {
                    let hash = attribute_hash(member);
                    if hash == command.wait_hash {
                        command.wait_stable_ticks += 1;
                    } else {
                        command.wait_hash = hash;
                        command.wait_stable_ticks = 1;
                    }
                    if command.wait_stable_ticks < ACK_SETTLE_TICKS {
                        kernel.command = command;
                        return;
                    }
                    command.completed_steps += 1;
                    command.phase = PHASE_SKILLS;
                    kernel.command = command;
                    continue;
                } else {
                    command.wait_hash = 0;
                    command.wait_stable_ticks = 0;
                    kernel.command = command;
                }
            }
            PHASE_SKILLS => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if skills_match(member, desired) {
                    command.phase = PHASE_BEHAVIOR;
                    kernel.command = command;
                    continue;
                }
                let index = command.member_index as usize;
                kernel.command = command;
                let skills = core::ptr::addr_of!(kernel.command.members[index].skills) as u32;
                unsafe { set_skillbar(member.agent_id, SKILL_SLOTS as u32, skills) };
                command.phase = PHASE_WAIT_SKILLS;
                command.wait_started = kernel.tick_count;
                command.wait_hash = 0;
                command.wait_stable_ticks = 0;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_SKILLS => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if let Some(skipped) = normalized_skills(member, desired) {
                    let hash = skillbar_hash(member.skills);
                    if hash == command.wait_hash {
                        command.wait_stable_ticks += 1;
                    } else {
                        command.wait_hash = hash;
                        command.wait_stable_ticks = 1;
                    }
                    if command.wait_stable_ticks < ACK_SETTLE_TICKS {
                        kernel.command = command;
                        return;
                    }
                    if skipped {
                        command.warnings |= COMMAND_WARNING_SKILLS_SKIPPED;
                    }
                    command.completed_steps += 1;
                    command.phase = PHASE_BEHAVIOR;
                    kernel.command = command;
                    continue;
                } else {
                    command.wait_hash = 0;
                    command.wait_stable_ticks = 0;
                    kernel.command = command;
                }
            }
            PHASE_BEHAVIOR => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if desired.hero_id == 0 {
                    advance_member(&mut command);
                    kernel.command = command;
                    if command.status == COMMAND_COMPLETE {
                        return;
                    }
                    continue;
                }
                if member.behavior == desired.behavior {
                    command.phase = PHASE_DISABLED_SKILLS;
                    kernel.command = command;
                    continue;
                }
                unsafe { set_hero_behavior(member.agent_id, desired.behavior) };
                command.phase = PHASE_WAIT_BEHAVIOR;
                command.wait_started = kernel.tick_count;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_BEHAVIOR => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                if member.behavior == desired.behavior {
                    command.completed_steps += 1;
                    command.phase = PHASE_DISABLED_SKILLS;
                    kernel.command = command;
                    continue;
                }
            }
            PHASE_DISABLED_SKILLS => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                let mismatch = member.disabled_skills ^ desired.disabled_skills;
                if mismatch == 0 {
                    command.phase = PHASE_PANEL;
                    kernel.command = command;
                    continue;
                }
                let slot = mismatch.trailing_zeros();
                unsafe { toggle_hero_skill(member.agent_id, slot) };
                command.phase = PHASE_WAIT_DISABLED_SKILL;
                command.wait_started = kernel.tick_count;
                command.wait_value = slot;
                kernel.command = command;
                return;
            }
            PHASE_WAIT_DISABLED_SKILL => {
                let desired = command.members[command.member_index as usize];
                let Some(member) = live_member(team, desired) else {
                    fail_command(kernel, ERROR_MEMBER_MISSING);
                    return;
                };
                let mask = 1 << command.wait_value;
                if member.disabled_skills & mask == desired.disabled_skills & mask {
                    command.completed_steps += 1;
                    command.phase = PHASE_DISABLED_SKILLS;
                    kernel.command = command;
                    continue;
                }
            }
            PHASE_PANEL => {
                let desired = command.members[command.member_index as usize];
                if desired.hero_id == 0 {
                    fail_command(kernel, ERROR_GAME_UNAVAILABLE);
                    return;
                }
                if desired.panel == 0 {
                    advance_member(&mut command);
                    kernel.command = command;
                    if command.status == COMMAND_COMPLETE {
                        return;
                    }
                    continue;
                }
                // The game's UI message dispatcher is synchronous and this is
                // an idempotent presentation setter, not a server request.
                // It therefore has no later game-state acknowledgement to
                // poll. Dispatch exactly once, then advance.
                unsafe { set_hero_panel(desired.hero_id, desired.panel - 1) };
                command.completed_steps += 1;
                advance_member(&mut command);
                kernel.command = command;
                if command.status == COMMAND_COMPLETE {
                    return;
                }
                continue;
            }
            PHASE_VERIFY => {
                if command.wait_value == 0 {
                    command.wait_value = 1;
                    command.wait_started = kernel.tick_count;
                }
                if team_matches(command, team) {
                    command.wait_stable_ticks += 1;
                    if command.wait_stable_ticks < FINAL_SETTLE_TICKS {
                        kernel.command = command;
                        return;
                    }
                    command.phase = PHASE_DONE;
                    command.status = COMMAND_COMPLETE;
                    kernel.command = command;
                    return;
                }
                command.wait_stable_ticks = 0;
                kernel.command = command;
            }
            _ => {
                fail_command(kernel, ERROR_GAME_UNAVAILABLE);
                return;
            }
        }
        if kernel.tick_count.wrapping_sub(command.wait_started) >= ACK_TIMEOUT_TICKS {
            fail_command(kernel, ERROR_TIMEOUT);
        }
        return;
    }
}

#[no_mangle]
pub unsafe extern "C" fn companion_apply_team(plan: u32, plan_size: u32) -> u32 {
    let Some(kernel) = (unsafe { kernel_state() }) else {
        return 0;
    };
    if kernel.initialized == 0
        || kernel.features & FEATURE_TEAM_MANAGEMENT == 0
        || kernel.command.status == COMMAND_RUNNING
        || plan_size != TEAM_PLAN_BYTES
        || plan & 3 != 0
        || !contains(plan, plan_size)
    {
        return 0;
    }
    let desired = unsafe { read_volatile(plan as *const DesiredTeam) };
    if !(1..=MAX_TEAM_MEMBERS as u32).contains(&desired.member_count)
        || desired.mode > 2
        || desired.reserved != [0; 2]
        || desired.members[0].hero_id != 0
        || desired.members[0].behavior != PLAYER_BEHAVIOR
        || desired.members[0].panel != 0
        || desired.members[0].disabled_skills != 0
        || desired.members[desired.member_count as usize..]
            .iter()
            .any(|member| !desired_member_is_empty(member))
    {
        return 0;
    }
    let mut seen_heroes = [0u32; MAX_OWNED_HEROES];
    for index in 0..desired.member_count as usize {
        let member = desired.members[index];
        let is_player = index == 0;
        if member.panel > 2
            || member.apply_build > 1
            || (!is_player
                && (!(1..=39).contains(&member.hero_id)
                    || seen_heroes[..index - 1].contains(&member.hero_id)))
            || (member.apply_build == 0
                && (member.primary != 0
                    || member.secondary != 0
                    || member.attribute_count != 0
                    || member.attribute_ids.iter().any(|value| *value != 0)
                    || member.attribute_ranks.iter().any(|value| *value != 0)
                    || member.skills.iter().any(|value| *value != 0)))
            || (!is_player && (member.behavior > 2 || member.disabled_skills > 0xff))
            || (member.apply_build == 1
                && (!(1..=10).contains(&member.primary)
                    || member.secondary > 10
                    || member.secondary == member.primary
                    || member.attribute_count > MAX_BUILD_ATTRIBUTES as u32))
        {
            return 0;
        }
        if !is_player {
            seen_heroes[index - 1] = member.hero_id;
        }
        for attribute in 0..member.attribute_count as usize {
            let id = member.attribute_ids[attribute];
            let rank = member.attribute_ranks[attribute];
            if !valid_attribute_id(id)
                || !(1..=12).contains(&rank)
                || member.attribute_ids[..attribute].contains(&id)
            {
                return 0;
            }
        }
        if member.attribute_ids[member.attribute_count as usize..]
            .iter()
            .any(|id| *id != 0)
            || member.attribute_ranks[member.attribute_count as usize..]
                .iter()
                .any(|rank| *rank != 0)
        {
            return 0;
        }
        for skill in 0..SKILL_SLOTS {
            let id = member.skills[skill];
            if id != 0 && member.skills[..skill].contains(&id) {
                return 0;
            }
        }
    }
    let next = TeamCommand {
        id: kernel.next_command_id.wrapping_add(1).max(1),
        status: COMMAND_RUNNING,
        phase: PHASE_ROSTER_REMOVE,
        completed_steps: 0,
        error: 0,
        warnings: 0,
        mode: desired.mode,
        member_count: desired.member_count,
        member_index: 0,
        wait_started: 0,
        wait_value: 0,
        wait_hash: 0,
        wait_stable_ticks: 0,
        members: desired.members,
    };
    kernel.next_command_id = next.id;
    kernel.command = next;
    next.id
}

unsafe fn publish(state: State, kernel: &mut KernelState) {
    let next = kernel.sequence.wrapping_add(2) & !1;
    let snapshot = kernel.snapshot_ptr as *mut Snapshot;
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, state.flags);
        write_volatile(&mut (*snapshot).tick_count, kernel.tick_count);
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
        kernel.sequence = next;
    }
}

unsafe fn publish_team(state: TeamState, kernel: &mut KernelState) {
    let next = kernel.team_sequence.wrapping_add(2) & !1;
    let snapshot = kernel.team_ptr as *mut TeamSnapshot;
    unsafe {
        write_volatile(&mut (*snapshot).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*snapshot).magic, TEAM_MAGIC);
        write_volatile(&mut (*snapshot).abi_and_size, TEAM_ABI_AND_SIZE);
        write_volatile(&mut (*snapshot).flags, state.flags);
        write_volatile(&mut (*snapshot).tick_count, kernel.tick_count);
        write_volatile(&mut (*snapshot).member_count, state.member_count);
        let command = kernel.command;
        write_volatile(&mut (*snapshot).command_id, command.id);
        write_volatile(&mut (*snapshot).command_status, command.status);
        write_volatile(&mut (*snapshot).command_phase, command.phase);
        write_volatile(
            &mut (*snapshot).command_completed_steps,
            command.completed_steps,
        );
        write_volatile(&mut (*snapshot).command_error, command.error);
        write_volatile(&mut (*snapshot).command_warnings, command.warnings);
        for member in 0..MAX_TEAM_MEMBERS {
            let target = &mut (*snapshot).members[member];
            let source = state.members[member];
            write_volatile(&mut target.agent_id, source.agent_id);
            write_volatile(&mut target.hero_id, source.hero_id);
            write_volatile(&mut target.primary, source.primary);
            write_volatile(&mut target.secondary, source.secondary);
            write_volatile(&mut target.behavior, source.behavior);
            write_volatile(&mut target.disabled_skills, source.disabled_skills);
            write_volatile(&mut target.attribute_count, source.attribute_count);
            write_volatile(&mut target.level, source.level);
            for attribute in 0..MAX_BUILD_ATTRIBUTES {
                write_volatile(
                    &mut target.attribute_ids[attribute],
                    source.attribute_ids[attribute],
                );
                write_volatile(
                    &mut target.attribute_ranks[attribute],
                    source.attribute_ranks[attribute],
                );
            }
            for skill in 0..SKILL_SLOTS {
                write_volatile(&mut target.skills[skill], source.skills[skill]);
            }
        }
        write_volatile(&mut (*snapshot).sequence, next);
        kernel.team_sequence = next;
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

#[repr(C)]
struct KernelState {
    snapshot_ptr: u32,
    layout: Layout,
    initialized: u32,
    features: u32,
    tick_count: u32,
    sequence: u32,
    team_ptr: u32,
    team_sequence: u32,
    command: TeamCommand,
    next_command_id: u32,
    cursor_ptr: u32,
    cursor_sequence: u32,
    cursor_generation: u32,
    cursor_published: CursorPublished,
}

unsafe fn kernel_state() -> Option<&'static mut KernelState> {
    let address = unsafe { enhancement_kernel_state() };
    if address & 3 != 0 || !contains(address, size_of::<KernelState>() as u32) {
        return None;
    }
    Some(unsafe { &mut *(address as *mut KernelState) })
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
    if unsafe { read_u32(offset(handle, layout.cursor_handle_key)?)? } != CURSOR_TEXTURE_KEY {
        return None;
    }
    let view = unsafe { pointer(offset(handle, layout.cursor_handle_object)?, 12)? };
    let texture = unsafe { pointer(offset(view, layout.cursor_view_texture)?, 0x68)? };
    if unsafe { read_u32(offset(texture, layout.cursor_texture_type)?)? } != CURSOR_TEXTURE_TYPE
        || unsafe { read_u32(offset(texture, layout.cursor_texture_width)?)? } != CURSOR_EDGE
        || unsafe { read_u32(offset(texture, layout.cursor_texture_height)?)? } != CURSOR_EDGE
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
    let hidden = unsafe { read_i32(layout.cursor_show_count) }.is_some_and(|count| count < 0);
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
unsafe fn publish_cursor(
    published: CursorPublished,
    source: Option<u32>,
    kernel: &mut KernelState,
) {
    let next = kernel.cursor_sequence.wrapping_add(2) & !1;
    let cursor = kernel.cursor_ptr as *mut CursorSnapshot;
    unsafe {
        write_volatile(&mut (*cursor).sequence, next.wrapping_sub(1));
        write_volatile(&mut (*cursor).magic, CURSOR_MAGIC);
        write_volatile(&mut (*cursor).abi_and_size, CURSOR_ABI_AND_SIZE);
        write_volatile(&mut (*cursor).flags, published.flags);
    }
    if let Some(source) = source {
        unsafe {
            kernel.cursor_generation = kernel.cursor_generation.wrapping_add(1);
            write_volatile(&mut (*cursor).generation, kernel.cursor_generation);
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
            let rgba = (word & 0xff00_ff00) | ((word >> 16) & 0xff) | ((word & 0xff) << 16);
            unsafe { write_volatile(&mut (*cursor).pixels[index as usize], rgba) };
        }
    }
    unsafe {
        write_volatile(&mut (*cursor).sequence, next);
        kernel.cursor_sequence = next;
        kernel.cursor_published = published;
    }
}

unsafe fn tick_cursor(layout: Layout, kernel: &mut KernelState) {
    let last = kernel.cursor_published;
    match unsafe { collect_cursor(layout) } {
        Ok(state) => {
            let published = CursorPublished {
                flags: FLAG_CURSOR_VALID | if state.hidden { FLAG_CURSOR_HIDDEN } else { 0 },
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
                unsafe { publish_cursor(published, bitmap.then_some(state.source), kernel) };
            }
        }
        Err(flags) => {
            if flags != last.flags {
                unsafe {
                    publish_cursor(CursorPublished { flags, ..last }, None, kernel)
                };
            }
        }
    }
}

// The region comes from the game's allocator, so clear it before the renderer
// can observe it.
unsafe fn clear_cursor(kernel: &mut KernelState) {
    let cursor = kernel.cursor_ptr as *mut CursorSnapshot;
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
pub extern "C" fn companion_state_size() -> u32 {
    size_of::<KernelState>() as u32
}

// The kernel produces all three shared-memory records. These packed
// `(bytes << 16) | abi` values let the renderer check the artifact it actually
// instantiated instead of trusting copied facts in the transformed game.
#[no_mangle]
pub extern "C" fn companion_snapshot_contract() -> u32 {
    ABI_AND_SIZE
}

#[no_mangle]
pub extern "C" fn companion_team_contract() -> u32 {
    TEAM_ABI_AND_SIZE
}

#[no_mangle]
pub extern "C" fn companion_cursor_contract() -> u32 {
    CURSOR_ABI_AND_SIZE
}

#[no_mangle]
pub unsafe extern "C" fn companion_init(
    snapshot_ptr: u32,
    snapshot_size: u32,
    config_ptr: u32,
    config_size: u32,
    cursor_ptr: u32,
    cursor_size: u32,
    team_ptr: u32,
    team_size: u32,
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
            features & FEATURE_TEAM_MANAGEMENT != 0,
            team_ptr,
            team_size,
            TEAM_BYTES,
        )
    {
        return 0;
    }
    let Some(kernel) = (unsafe { kernel_state() }) else {
        return 0;
    };
    unsafe {
        core::ptr::write_bytes(kernel as *mut KernelState, 0, 1);
        kernel.snapshot_ptr = snapshot_ptr;
        kernel.cursor_ptr = cursor_ptr;
        kernel.team_ptr = team_ptr;
        kernel.layout = read_volatile(config_ptr as *const Layout);
        kernel.features = features;
        kernel.initialized = 1;
        if features & FEATURE_TARGET_READOUT != 0 {
            publish(State::empty(), kernel);
        }
        if features & FEATURE_TEAM_MANAGEMENT != 0 {
            publish_team(empty_team(), kernel);
        }
        if features & FEATURE_NATIVE_CURSOR != 0 {
            clear_cursor(kernel);
            publish_cursor(CursorPublished::EMPTY, None, kernel);
        }
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn companion_tick(context: u32) {
    unsafe {
        tick_original(context);
        let Some(kernel) = kernel_state() else {
            return;
        };
        if kernel.initialized == 0 {
            return;
        }
        let features = kernel.features;
        let layout = kernel.layout;
        if features & FEATURE_TARGET_READOUT != 0 {
            kernel.tick_count = kernel.tick_count.wrapping_add(1);
            let state = collect(layout);
            publish(state, kernel);
            if features & FEATURE_TEAM_MANAGEMENT != 0 {
                let roster = collect_roster(layout, state);
                let team = collect_team(layout, state, roster);
                reconcile_team(layout, state, team, kernel);
                publish_team(team, kernel);
            }
        } else if features & FEATURE_TEAM_MANAGEMENT != 0 {
            kernel.tick_count = kernel.tick_count.wrapping_add(1);
            let state = collect(layout);
            let roster = collect_roster(layout, state);
            let team = collect_team(layout, state, roster);
            reconcile_team(layout, state, team, kernel);
            publish_team(team, kernel);
        }
        if features & FEATURE_NATIVE_CURSOR != 0 {
            tick_cursor(layout, kernel);
        }
    }
}
