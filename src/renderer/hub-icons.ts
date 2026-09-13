/**
 * One consistent icon family for Hub commands; game records may supply their own art.
 * Keeps presentation separate from canonical game and storage owners.
 */
import type { HubRow } from '../shared/hub.js';
const paths = {
  title: '<path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 13v6M7 21h10"/>',
  travel: '<path d="m12 3 8 8-8 10-8-10 8-8Z"/><circle cx="12" cy="10" r="2.5"/>',
  folder: '<path d="M3 6h7l2 3h9v11H3V6Z"/>',
  builds: '<path d="M5 4h11l3 3v13H5V4Z M8 8h6 M8 12h8 M8 16h5"/>',
  team: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M4 8a3 3 0 0 0 0 6M20 8a3 3 0 0 1 0 6M2 21v-2a4 4 0 0 1 3-4M22 21v-2a4 4 0 0 0-3-4"/>',
  trade: '<path d="M12 3v17M7 6h10M5 8l-3 7h6L5 8Zm14 0-3 7h6l-3-7ZM7 21h10"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  whispers: '<path d="M20 4H4v12h4l4 4v-4h8V4ZM8 8h8M8 12h5"/>',
  storage: '<path d="M3 10h18v11H3V10Zm0 0V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v3M8 3v7M16 3v7M10 10v5h4v-5"/>',
  maps: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  appearance: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  command: '<path d="m8 5 7 7-7 7"/>',
};
export function hubIcon(document: Document, row: Pick<HubRow, 'id' | 'group' | 'icon'>): HTMLElement {
  const icon = document.createElement('span'); icon.className = 'hub-icon'; icon.setAttribute('aria-hidden', 'true');
  if (row.icon) { const image = document.createElement('img'); image.src = row.icon; image.alt = ''; icon.append(image); return icon; }
  const id = row.id.split(':')[0];
  const kind = id === 'folder' || id === 'game-templates' ? 'folder' : row.group === 'Teams' || id === 'team' ? 'team'
    : row.group === 'Builds' || id === 'build' || id === 'builds' ? 'builds'
    : row.group === 'Places' || id === 'place' || id === 'travel' ? 'travel'
    : row.group === 'Accounts' || id === 'accounts' || row.group === 'People' || row.group === 'Heroes' || row.group === 'Characters' || id === 'character' ? 'person'
    : id === 'hub-preferences' ? 'settings' : id === 'call-target' ? 'target'
    : id && id in paths ? id as keyof typeof paths : 'command';
  icon.dataset.kind = kind;
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg>`;
  return icon;
}
