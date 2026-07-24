#![no_std]

use core::panic::PanicInfo;
use core::ptr::{read_volatile, write_volatile};

const SNAPSHOT_BYTES: u32 = 64;
const CONFIG_BYTES: u32 = 64;
const MAGIC: u32 = 0x4254_5747; // "GWTB" in little-endian memory.
const ABI_AND_SIZE: u32 = (SNAPSHOT_BYTES << 16) | 1;

const FLAG_READY: u32 = 1 << 0;
const FLAG_PLAYER_VALID: u32 = 1 << 1;
const FLAG_TARGET_VALID: u32 = 1 << 2;
const FLAG_LOADING: u32 = 1 << 3;

static mut SNAPSHOT_PTR: u32 = 0;
static mut CONFIG_PTR: u32 = 0;
static mut TICK_COUNT: u32 = 0;
static mut SEQUENCE: u32 = 0;

#[link(wasm_import_module = "game")]
extern "C" {
    #[link_name = "toolbox_tick_original"]
    fn tick_original(context: u32);
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

fn contains(address: u32, bytes: u32) -> bool {
    address <= memory_bytes() && bytes <= memory_bytes().saturating_sub(address)
}

unsafe fn read_u32(address: u32) -> Option<u32> {
    if !contains(address, 4) {
        return None;
    }
    Some(unsafe { read_volatile(address as *const u32) })
}

unsafe fn read_u16(address: u32) -> Option<u16> {
    if !contains(address, 2) {
        return None;
    }
    Some(unsafe { read_volatile(address as *const u16) })
}

unsafe fn read_f32(address: u32) -> Option<f32> {
    if !contains(address, 4) {
        return None;
    }
    Some(unsafe { read_volatile(address as *const f32) })
}

unsafe fn config(index: u32) -> u32 {
    unsafe { read_volatile((CONFIG_PTR + index * 4) as *const u32) }
}

unsafe fn pointer(address: u32, required_bytes: u32) -> Option<u32> {
    let value = unsafe { read_u32(address)? };
    if value & 3 == 0 && contains(value, required_bytes) {
        Some(value)
    } else {
        None
    }
}

fn finite_position(value: f32) -> bool {
    value.is_finite() && value.abs() <= 1_000_000.0
}

fn square_root(value: f32) -> f32 {
    if value <= 0.0 {
        return 0.0;
    }
    // Halving the IEEE-754 exponent gives a close square-root seed across the
    // full finite coordinate range; five Newton steps then reach f32 accuracy.
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
    for (index, limit) in RANGES.iter().enumerate() {
        if distance_squared <= *limit {
            return index as u32 + 1;
        }
    }
    8
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
    player: AgentState,
    target: AgentState,
    distance: f32,
    band: u32,
}

impl State {
    const fn empty() -> Self {
        Self {
            flags: 0,
            map_id: 0,
            instance_type: 0,
            player: AgentState {
                id: 0,
                kind: 0,
                x: 0.0,
                y: 0.0,
            },
            target: AgentState {
                id: 0,
                kind: 0,
                x: 0.0,
                y: 0.0,
            },
            distance: 0.0,
            band: 0,
        }
    }
}

unsafe fn read_agent(agent_buffer: u32, size: u32, id: u32) -> Option<AgentState> {
    if id == 0 || id >= size {
        return None;
    }
    let address = unsafe { pointer(agent_buffer + id * 4, 0x100)? };
    if unsafe { read_u32(address + config(10))? } != id {
        return None;
    }
    let x = unsafe { read_f32(address + config(11))? };
    let y = unsafe { read_f32(address + config(12))? };
    if !finite_position(x) || !finite_position(y) {
        return None;
    }
    Some(AgentState {
        id,
        kind: unsafe { read_u32(address + config(13))? },
        x,
        y,
    })
}

unsafe fn collect() -> State {
    let mut state = State::empty();
    let contexts = match unsafe { pointer(config(0), 28) } {
        Some(value) => value,
        None => return state,
    };
    let game = match unsafe { pointer(contexts + config(3) * 4, 0x50) } {
        Some(value) => value,
        None => return state,
    };
    let character = match unsafe { pointer(game + config(4), 0x2b0) } {
        Some(value) => value,
        None => return state,
    };

    let base_map = match unsafe { read_u32(character + config(5)) } {
        Some(value) => value,
        None => return state,
    };
    let is_explorable = match unsafe { read_u32(character + config(6)) } {
        Some(value) => value,
        None => return state,
    };
    let map_id = match unsafe { read_u32(character + config(7)) } {
        Some(value) => value,
        None => return state,
    };
    let instance_type = match unsafe { read_u32(character + config(8)) } {
        Some(value) => value,
        None => return state,
    };
    let player_number = match unsafe { read_u32(character + config(9)) } {
        Some(value) => value,
        None => return state,
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
    {
        return state;
    }

    let array = unsafe { config(1) };
    if !contains(array, 16) {
        return state;
    }
    let agent_buffer = match unsafe { read_u32(array) } {
        Some(value) => value,
        None => return state,
    };
    let capacity = match unsafe { read_u32(array + 4) } {
        Some(value) => value,
        None => return state,
    };
    let size = match unsafe { read_u32(array + 8) } {
        Some(value) => value,
        None => return state,
    };
    if size == 0
        || size > capacity
        || capacity > 4_096
        || !contains(agent_buffer, size.saturating_mul(4))
    {
        return state;
    }

    for id in 1..size {
        let agent_address = match unsafe { pointer(agent_buffer + id * 4, 0x100) } {
            Some(value) => value,
            None => continue,
        };
        if unsafe { read_u32(agent_address + config(10)) } != Some(id)
            || unsafe { read_u16(agent_address + config(14)) } != Some(player_number as u16)
            || unsafe { read_u16(agent_address + config(15)) }
                .map(|value| value & 0xf000)
                != Some(0x3000)
            || unsafe { read_u32(agent_address + config(13)) }
                .map(|value| value & 0xdb)
                == Some(0)
        {
            continue;
        }
        let Some(player) = (unsafe { read_agent(agent_buffer, size, id) }) else {
            return state;
        };
        state.flags = FLAG_READY | FLAG_PLAYER_VALID;
        state.map_id = map_id;
        state.instance_type = instance_type;
        state.player = player;
        break;
    }
    if state.flags & FLAG_PLAYER_VALID == 0 {
        return State::empty();
    }

    let target_address = unsafe { config(2) };
    if target_address != 0 {
        if let Some(target_id) = unsafe { read_u32(target_address) } {
            if let Some(target) = unsafe { read_agent(agent_buffer, size, target_id) } {
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

unsafe fn publish(state: State) {
    let snapshot = unsafe { SNAPSHOT_PTR };
    let next = unsafe { SEQUENCE }.wrapping_add(2) & !1;
    unsafe {
        write_volatile((snapshot + 8) as *mut u32, next.wrapping_sub(1));
        write_volatile(snapshot as *mut u32, MAGIC);
        write_volatile((snapshot + 4) as *mut u32, ABI_AND_SIZE);
        write_volatile((snapshot + 12) as *mut u32, state.flags);
        write_volatile((snapshot + 16) as *mut u32, TICK_COUNT);
        write_volatile((snapshot + 20) as *mut u32, state.map_id);
        write_volatile((snapshot + 24) as *mut u32, state.instance_type);
        write_volatile((snapshot + 28) as *mut u32, state.player.id);
        write_volatile((snapshot + 32) as *mut f32, state.player.x);
        write_volatile((snapshot + 36) as *mut f32, state.player.y);
        write_volatile((snapshot + 40) as *mut u32, state.target.id);
        write_volatile((snapshot + 44) as *mut u32, state.target.kind);
        write_volatile((snapshot + 48) as *mut f32, state.target.x);
        write_volatile((snapshot + 52) as *mut f32, state.target.y);
        write_volatile((snapshot + 56) as *mut f32, state.distance);
        write_volatile((snapshot + 60) as *mut u32, state.band);
        write_volatile((snapshot + 8) as *mut u32, next);
        SEQUENCE = next;
    }
}

#[no_mangle]
pub unsafe extern "C" fn toolbox_init(
    snapshot_ptr: u32,
    snapshot_size: u32,
    config_ptr: u32,
    config_size: u32,
) -> u32 {
    if snapshot_size != SNAPSHOT_BYTES
        || config_size != CONFIG_BYTES
        || snapshot_ptr & 3 != 0
        || config_ptr & 3 != 0
        || !contains(snapshot_ptr, snapshot_size)
        || !contains(config_ptr, config_size)
    {
        return 0;
    }
    unsafe {
        SNAPSHOT_PTR = snapshot_ptr;
        CONFIG_PTR = config_ptr;
        TICK_COUNT = 0;
        SEQUENCE = 0;
        publish(State::empty());
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn toolbox_tick(context: u32) {
    unsafe {
        tick_original(context);
        if SNAPSHOT_PTR == 0 || CONFIG_PTR == 0 {
            return;
        }
        TICK_COUNT = TICK_COUNT.wrapping_add(1);
        let state = collect();
        publish(state);
    }
}
