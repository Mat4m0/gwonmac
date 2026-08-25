//! The shared wire format: the configuration the host installs, the three
//! snapshots the kernel publishes, and the constants both sides compare
//! against. Declarations only — no logic and no unsafe code.
//!
//! Every published type is `repr(C)` and none of them contains a pointer, so a
//! snapshot is meaningful to a reader that only knows the byte layout. The
//! size assertions at the end of the file pin the exact byte counts the
//! renderer decodes: a field added, widened, or reordered fails the build
//! instead of silently shifting every value after it. Those same sizes are
//! what `companion_init` measures the host's regions against, so the
//! assertions are also the reason a bounds check here is a bounds check there.

use core::mem::size_of;

pub(crate) const SNAPSHOT_BYTES: u32 = size_of::<Snapshot>() as u32;
pub(crate) const CONFIG_BYTES: u32 = size_of::<Layout>() as u32;
pub(crate) const MAGIC: u32 = 0x4254_5747;
pub(crate) const ABI_AND_SIZE: u32 = (SNAPSHOT_BYTES << 16) | 4;

pub(crate) const FLAG_READY: u32 = 1 << 0;
pub(crate) const FLAG_PLAYER_VALID: u32 = 1 << 1;
pub(crate) const FLAG_TARGET_VALID: u32 = 1 << 2;
pub(crate) const FLAG_LOADING: u32 = 1 << 3;
/// The player-record and map walk completed without a contradiction.
pub(crate) const FLAG_XUNLAI_ACCESS_OBSERVED: u32 = 1 << 4;
/// Storage access is positively allowed. Meaningful only with the observed bit.
pub(crate) const FLAG_XUNLAI_ACCESS_ALLOWED: u32 = 1 << 5;
/// The current character's complete, bounded map-unlock bitset was read.
pub(crate) const FLAG_TRAVEL_UNLOCKS_OBSERVED: u32 = 1 << 6;

pub(crate) const FEATURE_NATIVE_CURSOR: u32 = 1 << 0;
pub(crate) const FEATURE_GAME_SNAPSHOT: u32 = 1 << 1;
pub(crate) const FEATURE_TOOLBOX_FOUNDATION: u32 = 1 << 2;
pub(crate) const FEATURE_TARGET_OBSERVATION: u32 = 1 << 3;
pub(crate) const FEATURE_SKILL_SLOT_GEOMETRY: u32 = 1 << 4;
pub(crate) const FEATURE_SKILL_COOLDOWN_OBSERVATION: u32 = 1 << 5;
pub(crate) const FEATURE_PLAY_REGION_OBSERVATION: u32 = 1 << 6;
pub(crate) const KNOWN_FEATURES: u32 =
    FEATURE_NATIVE_CURSOR | FEATURE_GAME_SNAPSHOT | FEATURE_TOOLBOX_FOUNDATION
        | FEATURE_TARGET_OBSERVATION | FEATURE_SKILL_SLOT_GEOMETRY
        | FEATURE_SKILL_COOLDOWN_OBSERVATION | FEATURE_PLAY_REGION_OBSERVATION;

pub(crate) const PLAY_REGION_BYTES: u32 = size_of::<PlayRegionSnapshot>() as u32;
pub(crate) const PLAY_REGION_MAGIC: u32 = 0x5250_5747;
pub(crate) const PLAY_REGION_ABI_AND_SIZE: u32 = (PLAY_REGION_BYTES << 16) | 1;
pub(crate) const FLAG_PLAY_REGION_READY: u32 = 1 << 0;
pub(crate) const FLAG_PLAY_REGION_LOADING: u32 = 1 << 1;

pub(crate) const SKILL_SLOT_BYTES: u32 = size_of::<SkillSlotSnapshot>() as u32;
pub(crate) const SKILL_SLOT_MAGIC: u32 = 0x534b_5747;
pub(crate) const SKILL_SLOT_ABI_AND_SIZE: u32 = (SKILL_SLOT_BYTES << 16) | 1;
pub(crate) const FLAG_SKILL_SLOTS_READY: u32 = 1 << 0;

pub(crate) const SKILL_COOLDOWN_BYTES: u32 = size_of::<SkillCooldownSnapshot>() as u32;
pub(crate) const SKILL_COOLDOWN_MAGIC: u32 = 0x5343_5747;
pub(crate) const SKILL_COOLDOWN_ABI_AND_SIZE: u32 = (SKILL_COOLDOWN_BYTES << 16) | 1;
pub(crate) const FLAG_SKILL_COOLDOWNS_READY: u32 = 1 << 0;
pub(crate) const FLAG_SKILL_COOLDOWNS_LOADING: u32 = 1 << 1;

pub(crate) const TOOLBOX_BYTES: u32 = size_of::<ToolboxSnapshot>() as u32;
pub(crate) const TOOLBOX_MAGIC: u32 = 0x5854_5747;
pub(crate) const TOOLBOX_ABI_AND_SIZE: u32 = (TOOLBOX_BYTES << 16) | 4;
pub(crate) const FLAG_HERO_AVAILABLE: u32 = 1 << 0;
/// The party walk ran to completion on a live game this publication.
///
/// Without it, "you have no heroes" and "your party could not be read" are the
/// same bytes — `hero_count` 0 with no hero flag — and a reader has no way to
/// tell them apart. During a map load the second is true and the first is what
/// the interface said.
///
/// A positive assertion on purpose: a publication claims an observation only
/// when one happened, so anything that goes wrong anywhere in the walk leaves
/// the claim unmade rather than needing its own error bit.
pub(crate) const FLAG_PARTY_OBSERVED: u32 = 1 << 1;

pub(crate) const DISPATCH_TICK: u32 = 0;
pub(crate) const DISPATCH_CURSOR: u32 = 1;
pub(crate) const DISPATCH_UI: u32 = 2;
pub(crate) const DISPATCH_ACTIVE_FEATURES: u32 = 3;
pub(crate) const PARTY_DIRTY_MESSAGE_COUNT: usize = 10;

pub(crate) const PARTY_BYTES: u32 = size_of::<PartySnapshot>() as u32;
pub(crate) const PARTY_MAGIC: u32 = 0x5054_5747;
pub(crate) const PARTY_ABI_AND_SIZE: u32 = (PARTY_BYTES << 16) | 7;

/// The walk completed on a live game. Same meaning, and the same reason, as
/// `FLAG_PARTY_OBSERVED` on the toolbox region: an empty roster and an unread
/// one are otherwise identical bytes.
pub(crate) const FLAG_ROSTER_OBSERVED: u32 = 1 << 0;
/// The account's hero table was read, so `unlocked_*` and `unlock_known_*`
/// mean something. Without it both pairs are zero and claim nothing.
pub(crate) const FLAG_UNLOCK_OBSERVED: u32 = 1 << 1;
/// The instance is an outpost. Meaningful only beside `FLAG_ROSTER_OBSERVED`,
/// which is the walk that read it — a party nobody looked at says nothing about
/// where it is standing. Published because applying a team is an outpost-only
/// operation and the interface has to be able to refuse before it starts
/// rather than half-way through.
pub(crate) const FLAG_IN_OUTPOST: u32 = 1 << 2;
/// The party context's difficulty bit was read.
pub(crate) const FLAG_HARD_MODE_OBSERVED: u32 = 1 << 3;
/// The account-wide unlock bitset was read from AccountContext. These skills
/// are available to heroes and count as account unlocks, but are not proof
/// that the current character has learned them.
pub(crate) const FLAG_ACCOUNT_SKILLS_OBSERVED: u32 = 1 << 4;
/// The current character's learned-skill bitset was read from WorldContext.
pub(crate) const FLAG_CHARACTER_SKILLS_OBSERVED: u32 = 1 << 5;

pub(crate) const PLAY_REGION_UNKNOWN: u32 = 0;
pub(crate) const PLAY_REGION_PVE: u32 = 1;
pub(crate) const PLAY_REGION_PVP: u32 = 2;

/// This slot holds a hero. An unoccupied slot publishes nothing else.
pub(crate) const SLOT_OCCUPIED: u32 = 1 << 0;
/// Professions and level were read from the party member.
pub(crate) const SLOT_PROFESSIONS: u32 = 1 << 1;
/// Behaviour was read from the hero-flag array.
pub(crate) const SLOT_BEHAVIOUR: u32 = 1 << 2;
/// The eight skill ids and the disabled mask were read from a valid skillbar.
pub(crate) const SLOT_SKILLS: u32 = 1 << 3;
/// The attribute table was read. Distinct from the ranks being all zero, which
/// is a real answer: a character who has spent nothing.
pub(crate) const SLOT_ATTRIBUTES: u32 = 1 << 4;

pub(crate) const PARTY_SLOTS: usize = 8;
pub(crate) const ACCOUNT_HERO_SLOTS: usize = 40;
pub(crate) const SKILL_SLOTS: usize = 8;
/// The official client currently publishes 70 words, covering skill ids
/// 0..2239. A fixed bound keeps account data finite and the wire shape closed.
pub(crate) const SKILL_UNLOCK_WORDS: usize = 70;
/// Covers map ids 0..895, including every reviewed Quick Travel destination.
pub(crate) const TRAVEL_UNLOCK_WORDS: usize = 28;

/// The highest attribute id the client defines. The array is walked to here
/// and no further: the reference struct pads to 54 entries and indices 51-53
/// hold values that decode as plausible ranks.
pub(crate) const ATTRIBUTE_ID_MAX: u32 = 44;

/// The most attributes one character can have invested.
///
/// Five, from a primary profession with five (Warrior, Elementalist), plus
/// four from a secondary: a character may not invest in its secondary
/// profession's own primary attribute. Measured against three live characters
/// spanning four professions, every one of which is missing exactly that one
/// id from its secondary's run.
pub(crate) const ATTRIBUTE_SLOTS: usize = 9;

pub(crate) const CURSOR_BYTES: u32 = size_of::<CursorSnapshot>() as u32;
pub(crate) const CURSOR_MAGIC: u32 = 0x4354_5747;
pub(crate) const CURSOR_ABI_AND_SIZE: u32 = (CURSOR_BYTES << 16) | 1;

pub(crate) const FLAG_CURSOR_VALID: u32 = 1 << 0;
pub(crate) const FLAG_CURSOR_HIDDEN: u32 = 1 << 1;
pub(crate) const FLAG_CURSOR_UNSUPPORTED: u32 = 1 << 2;

pub(crate) const CURSOR_EDGE: u32 = 32;
pub(crate) const CURSOR_WORDS: u32 = CURSOR_EDGE * CURSOR_EDGE;
pub(crate) const CURSOR_PIXEL_BYTES: u32 = CURSOR_WORDS * 4;
// 'grtx', the texture handle's access key.
pub(crate) const CURSOR_TEXTURE_KEY: u32 = 0x6772_7478;
pub(crate) const CURSOR_TEXTURE_TYPE: u32 = 10;

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Layout {
    pub(crate) context_root: u32,
    pub(crate) agent_array: u32,
    pub(crate) manual_target_agent_id: u32,
    pub(crate) automatic_target_agent_id: u32,
    pub(crate) game_context_slot: u32,
    pub(crate) character_context: u32,
    pub(crate) map_id: u32,
    pub(crate) is_explorable: u32,
    pub(crate) current_map_id: u32,
    pub(crate) current_instance_type: u32,
    pub(crate) player_number: u32,
    pub(crate) agent_id: u32,
    pub(crate) agent_x: u32,
    pub(crate) agent_y: u32,
    pub(crate) agent_type: u32,
    pub(crate) agent_player_number: u32,
    pub(crate) agent_model_type: u32,
    pub(crate) cursor_active_art: u32,
    pub(crate) cursor_software_model: u32,
    pub(crate) cursor_show_count: u32,
    pub(crate) cursor_color_buffer: u32,
    pub(crate) cursor_art_hotspot: u32,
    pub(crate) cursor_art_texture: u32,
    pub(crate) cursor_handle_key: u32,
    pub(crate) cursor_handle_object: u32,
    pub(crate) cursor_view_texture: u32,
    pub(crate) cursor_texture_type: u32,
    pub(crate) cursor_texture_width: u32,
    pub(crate) cursor_texture_height: u32,
    pub(crate) party_context: u32,
    pub(crate) player_party: u32,
    pub(crate) party_heroes: u32,
    pub(crate) hero_member_stride: u32,
    pub(crate) hero_agent_id: u32,
    pub(crate) hero_owner_player_id: u32,
    pub(crate) hero_id: u32,
    // A further field of the `HeroPartyMember` the walk above already indexes,
    // so it costs no new pointer chain. Professions are deliberately absent:
    // the client leaves them zero in this struct even for a Warrior, and they
    // are read from `HeroInfo` instead.
    pub(crate) hero_level: u32,
    // The rest of the party, and the difficulty flag beside it.
    pub(crate) party_players: u32,
    pub(crate) party_henchmen: u32,
    pub(crate) party_flag: u32,
    // GameContext -> AccountContext -> account-wide unlocked-skill bitset.
    pub(crate) account_context_slot: u32,
    pub(crate) account_unlocked_skills: u32,
    // GameContext -> WorldContext, and the three arrays hanging off it that
    // describe heroes rather than party membership.
    pub(crate) world_context: u32,
    pub(crate) world_hero_flags: u32,
    pub(crate) hero_flag_stride: u32,
    pub(crate) flag_hero_id: u32,
    pub(crate) flag_agent_id: u32,
    pub(crate) flag_behavior: u32,
    pub(crate) world_hero_info: u32,
    pub(crate) hero_info_stride: u32,
    pub(crate) info_hero_id: u32,
    /// Zero while the hero is unlocked but not in the party, and the live agent
    /// id while it is. One array therefore answers both "what does this account
    /// own" and "who is in the party right now".
    pub(crate) info_agent_id: u32,
    pub(crate) info_level: u32,
    pub(crate) info_primary: u32,
    pub(crate) info_secondary: u32,
    pub(crate) info_appearance_bitmap: u32,
    pub(crate) world_skillbars: u32,
    pub(crate) skillbar_stride: u32,
    pub(crate) skillbar_agent_id: u32,
    pub(crate) skillbar_skills: u32,
    pub(crate) skill_slot_stride: u32,
    pub(crate) skill_slot_id: u32,
    pub(crate) skillbar_disabled: u32,
    pub(crate) world_attributes: u32,
    pub(crate) attribute_stride: u32,
    pub(crate) attribute_agent_id: u32,
    pub(crate) attribute_entries: u32,
    pub(crate) attribute_entry_stride: u32,
    pub(crate) attribute_entry_id: u32,
    pub(crate) attribute_entry_rank: u32,
    pub(crate) area_info: u32,
    pub(crate) area_info_count: u32,
    pub(crate) area_info_stride: u32,
    pub(crate) area_info_flags: u32,
    // Appended to preserve the positional meaning of every earlier config
    // word. This is WorldContext::party_profession_states and its row stride.
    pub(crate) world_profession_states: u32,
    pub(crate) profession_state_stride: u32,
    pub(crate) world_character_skills: u32,
    // Appended build-certified facts used only by the Xunlai access proof.
    pub(crate) world_players: u32,
    pub(crate) player_record_stride: u32,
    pub(crate) player_record_agent_id: u32,
    pub(crate) player_record_access_flags: u32,
    pub(crate) player_record_number: u32,
    pub(crate) area_info_type: u32,
    pub(crate) frame_array: u32,
    pub(crate) frame_count: u32,
    pub(crate) frame_bytes: u32,
    pub(crate) frame_child_offset_id: u32,
    pub(crate) frame_id: u32,
    pub(crate) frame_position_flags: u32,
    pub(crate) frame_viewport_width: u32,
    pub(crate) frame_viewport_height: u32,
    pub(crate) frame_screen_left: u32,
    pub(crate) frame_screen_bottom: u32,
    pub(crate) frame_screen_right: u32,
    pub(crate) frame_screen_top: u32,
    pub(crate) frame_relation: u32,
    pub(crate) frame_state: u32,
    // Appended exact-client field used only by cooldown observation.
    pub(crate) skill_slot_recharge: u32,
    pub(crate) world_unlocked_maps: u32,
    pub(crate) player_chat_message: u32,
    pub(crate) hide_hero_panel_message: u32,
    pub(crate) show_hero_panel_message: u32,
    pub(crate) party_dirty_messages: [u32; PARTY_DIRTY_MESSAGE_COUNT],
}

impl Layout {
    pub(crate) const EMPTY: Self = Self {
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
        hero_level: 0,
        party_players: 0,
        party_henchmen: 0,
        party_flag: 0,
        account_context_slot: 0,
        account_unlocked_skills: 0,
        world_context: 0,
        world_hero_flags: 0,
        hero_flag_stride: 0,
        flag_hero_id: 0,
        flag_agent_id: 0,
        flag_behavior: 0,
        world_hero_info: 0,
        hero_info_stride: 0,
        info_hero_id: 0,
        info_agent_id: 0,
        info_level: 0,
        info_primary: 0,
        info_secondary: 0,
        info_appearance_bitmap: 0,
        world_skillbars: 0,
        skillbar_stride: 0,
        skillbar_agent_id: 0,
        skillbar_skills: 0,
        skill_slot_stride: 0,
        skill_slot_id: 0,
        skillbar_disabled: 0,
        world_attributes: 0,
        attribute_stride: 0,
        attribute_agent_id: 0,
        attribute_entries: 0,
        attribute_entry_stride: 0,
        attribute_entry_id: 0,
        attribute_entry_rank: 0,
        area_info: 0,
        area_info_count: 0,
        area_info_stride: 0,
        area_info_flags: 0,
        world_profession_states: 0,
        profession_state_stride: 0,
        world_character_skills: 0,
        world_players: 0,
        player_record_stride: 0,
        player_record_agent_id: 0,
        player_record_access_flags: 0,
        player_record_number: 0,
        area_info_type: 0,
        frame_array: 0,
        frame_count: 0,
        frame_bytes: 0,
        frame_child_offset_id: 0,
        frame_id: 0,
        frame_position_flags: 0,
        frame_viewport_width: 0,
        frame_viewport_height: 0,
        frame_screen_left: 0,
        frame_screen_bottom: 0,
        frame_screen_right: 0,
        frame_screen_top: 0,
        frame_relation: 0,
        frame_state: 0,
        skill_slot_recharge: 0,
        world_unlocked_maps: 0,
        player_chat_message: 0,
        hide_hero_panel_message: 0,
        show_hero_panel_message: 0,
        party_dirty_messages: [0; PARTY_DIRTY_MESSAGE_COUNT],
    };
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Snapshot {
    pub(crate) magic: u32,
    pub(crate) abi_and_size: u32,
    pub(crate) sequence: u32,
    pub(crate) flags: u32,
    pub(crate) tick_count: u32,
    pub(crate) map_id: u32,
    /// Instance type in the low byte, `PLAY_REGION_*` in the next byte.
    pub(crate) instance_and_region: u32,
    pub(crate) player_id: u32,
    pub(crate) player_x: f32,
    pub(crate) player_y: f32,
    pub(crate) target_id: u32,
    pub(crate) target_type: u32,
    pub(crate) target_x: f32,
    pub(crate) target_y: f32,
    pub(crate) distance: f32,
    pub(crate) range_band: u32,
    pub(crate) unlocked_maps: [u32; TRAVEL_UNLOCK_WORDS],
}

#[repr(C)]
pub(crate) struct PlayRegionSnapshot {
    pub(crate) magic: u32,
    pub(crate) abi_and_size: u32,
    pub(crate) sequence: u32,
    pub(crate) flags: u32,
    pub(crate) map_id: u32,
    pub(crate) instance_type: u32,
    pub(crate) play_region: u32,
}

#[repr(C)]
pub(crate) struct CursorSnapshot {
    pub(crate) magic: u32,
    pub(crate) abi_and_size: u32,
    pub(crate) sequence: u32,
    pub(crate) flags: u32,
    pub(crate) generation: u32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) hotspot_x: u32,
    pub(crate) hotspot_y: u32,
    pub(crate) pixel_hash: u32,
    pub(crate) reserved: [u32; 6],
    pub(crate) pixels: [u32; 1024],
}

#[repr(C)]
pub(crate) struct ToolboxSnapshot {
    pub(crate) magic: u32,
    pub(crate) abi_and_size: u32,
    pub(crate) sequence: u32,
    pub(crate) flags: u32,
    pub(crate) player_chat_count: u32,
    pub(crate) cursor_event_count: u32,
    pub(crate) hero_count: u32,
    pub(crate) first_hero_id: u32,
    pub(crate) first_hero_agent_id: u32,
    pub(crate) reserved: [u32; 7],
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct SkillSlotRect {
    pub(crate) left: f32,
    pub(crate) bottom: f32,
    pub(crate) right: f32,
    pub(crate) top: f32,
}

#[repr(C)]
pub(crate) struct SkillSlotSnapshot {
    pub(crate) magic: u32,
    pub(crate) abi_and_size: u32,
    pub(crate) sequence: u32,
    pub(crate) flags: u32,
    pub(crate) frame_id: u32,
    pub(crate) viewport_width: f32,
    pub(crate) viewport_height: f32,
    pub(crate) slots: [SkillSlotRect; SKILL_SLOTS],
}

#[repr(C)]
pub(crate) struct SkillCooldownSnapshot {
    pub(crate) magic: u32,
    pub(crate) abi_and_size: u32,
    pub(crate) sequence: u32,
    pub(crate) flags: u32,
    pub(crate) generation: u32,
    pub(crate) game_timer: u32,
    pub(crate) player_agent_id: u32,
    pub(crate) recharge_timestamps: [u32; SKILL_SLOTS],
}

/// One party position, as much of it as has been read.
///
/// Every field is paired with a bit in `flags` that says whether it was read.
/// A zero `level` and an unread `level` are the same word otherwise, and a bar
/// of eight zeroes is a real skillbar shape — so absence has to be stated
/// rather than inferred from the value, exactly as it is for the roster.
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct PartySlot {
    pub(crate) hero_id: u32,
    pub(crate) agent_id: u32,
    /// `primary | secondary << 8`. Both are 0-10, so they share a word rather
    /// than costing two.
    pub(crate) professions: u32,
    pub(crate) level: u32,
    pub(crate) behaviour: u32,
    pub(crate) flags: u32,
    /// The client's disabled mask, `& 0xFF`, widened to the region's word.
    pub(crate) disabled: u32,
    pub(crate) skills: [u32; SKILL_SLOTS],
    /// Invested attribute ranks, each `id | rank << 8`. A word whose rank byte
    /// is zero is an unused entry, not "FastCasting at rank 0" — only invested
    /// attributes are published, which is also how `AttributeRanks` reads an
    /// absent one on the other side.
    pub(crate) attributes: [u32; ATTRIBUTE_SLOTS],
}

#[repr(C)]
pub(crate) struct PartySnapshot {
    pub(crate) magic: u32,
    pub(crate) abi_and_size: u32,
    pub(crate) sequence: u32,
    pub(crate) flags: u32,
    /// Bumps on any change to the roster, so a reader can tell "same party,
    /// republished" from "different party" without comparing eight slots.
    pub(crate) generation: u32,
    pub(crate) slot_count: u32,
    /// Hero ids 0..31 and 32..63. Every hero id fits in six bits, so the whole
    /// account's unlock state is two words rather than thirty-nine records.
    pub(crate) unlocked_low: u32,
    pub(crate) unlocked_high: u32,
    /// Which bits of `unlocked_*` were actually decided. A mercenary whose
    /// rule needs the current character's name is *unknown*, not locked, and
    /// the two must not arrive as the same zero bit.
    pub(crate) unlock_known_low: u32,
    pub(crate) unlock_known_high: u32,
    pub(crate) play_region: u32,
    pub(crate) hard_mode: u32,
    /// Bounded player-profession probe: canonical state values, admitted
    /// attribute ids 0..31 and 32..44, then source flags. It exists so
    /// an unsupported official-client layout can be diagnosed without names,
    /// account data, pointers, or arbitrary memory leaving the kernel.
    pub(crate) player_profession_probe: [u32; 4],
    /// `primary | secondary << 8`, indexed by HeroId. Zero means unread.
    pub(crate) account_professions: [u32; ACCOUNT_HERO_SLOTS],
    pub(crate) slots: [PartySlot; PARTY_SLOTS],
    /// Valid words in each bitset. Bits outside the corresponding count are
    /// unknown, never locked.
    pub(crate) account_skill_words: u32,
    pub(crate) character_skill_words: u32,
    pub(crate) account_skills: [u32; SKILL_UNLOCK_WORDS],
    pub(crate) character_skills: [u32; SKILL_UNLOCK_WORDS],
}

const _: [(); 448] = [(); size_of::<Layout>()];
const _: [(); 96] = [(); size_of::<PartySlot>()];
const _: [(); 1560] = [(); size_of::<PartySnapshot>()];
const _: [(); 176] = [(); size_of::<Snapshot>()];
const _: [(); 4160] = [(); size_of::<CursorSnapshot>()];
const _: [(); 64] = [(); size_of::<ToolboxSnapshot>()];
const _: [(); 16] = [(); size_of::<SkillSlotRect>()];
const _: [(); 156] = [(); size_of::<SkillSlotSnapshot>()];
const _: [(); 60] = [(); size_of::<SkillCooldownSnapshot>()];
const _: [(); 28] = [(); size_of::<PlayRegionSnapshot>()];
