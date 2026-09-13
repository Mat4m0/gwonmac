/**
 * Shared tool names and descriptions for launcher and in-game preferences.
 * Tool availability and persistence remain owned by their existing policies.
 */
import type { GlobalTool } from "./launcher-contracts.js";
import type { ShortcutAction } from "./keyboard-shortcuts.js";
export const TOOL_PRESENTATION: Record<GlobalTool, { label: string; description: string; action?: ShortcutAction }> = {
  whispers: { label: "Whispers", description: "A movable whisper panel alongside original chat. Conversations last for this session only.", action: "whispers.toggle" },
  "call-target": { label: "Call target", description: "Call the selected target without attacking. Sends Control-Shift-Space and requires Guild Wars’ default controls. Inactive while typing.", action: "game.call-target" },
  resign: { label: "Resign", description: "Ask before sending /resign in PvE. Enter confirms; Escape cancels.", action: "game.resign" },
  "character-switch": { label: "Character Switch", description: "Search and browse every character. Available without optional Tools.", action: "character.switch" },
  "build-management": { label: "Build Library", description: "Save and load skill builds.", action: "tools.toggle" },
  "quick-travel": { label: "Quick Travel", description: "Search destinations and travel between outposts.", action: "travel.open" },
  "xunlai-storage": { label: "Xunlai Storage", description: "Open storage in supported outposts.", action: "storage.open" },
  "quick-item-move": { label: "Quick Item Move", description: "Control-click items to move whole stacks through open storage or trade windows. Add Shift to choose an amount." },
  "trade-chat": { label: "Trade Chat", description: "Browse the trade feed.", action: "trade.toggle" },
  maps: { label: "Maps", description: "Exploration grid and walkable terrain on supported PvE maps." },
  "target-readout": { label: "Target Distance", description: "Show distance to the selected target in PvE." },
  "skill-key-labels": { label: "Skill Key Labels", description: "Show your own control labels on the eight skill slots." },
  "skill-cooldowns": { label: "Skill Cooldowns", description: "Show numeric recharge timers on the skill bar." },
  "chat-filters": { label: "Chat Filters", description: "Hide selected system notices before they enter chat." },
  "alcohol-timer": { label: "Alcohol Timer", description: "A quiet, movable alcohol countdown. Hidden when sober; amber in the last 15 seconds." },
  "effect-timers": { label: "Effect Timers", description: "Show exact remaining time on your native Effects icons." },
};
