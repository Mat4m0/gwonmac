/**
 * Presents saved account choices through the native account owner.
 * Search never opens or closes a game window; each operation is explicit, and
 * closing the running game passes an armed confirmation first.
 */
import { hubMatch, normaliseHubQuery, parseHubQuery, type HubPresenter, type HubRow, type HubSource } from '../shared/hub.js';
import type { HubAccountsSnapshot, HubAccountRequest } from '../shared/accounts-contracts.js';
export function createHubAccounts(hub: HubPresenter<HTMLElement>, api: { get(): Promise<HubAccountsSnapshot>; open(request: HubAccountRequest): Promise<void>; manage?(): Promise<void> }): HubSource {
  let snapshot: HubAccountsSnapshot | null = null;
  let visible = false;
  let generation = 0;
  let problem = '';
  async function load() {
    const request = ++generation;
    try {
      const next = await api.get();
      if (request !== generation) return;
      if (snapshot && snapshot.current !== next.current) hub.close();
      snapshot = next; problem = ''; refresh();
    } catch { if (request === generation) { problem = 'Accounts could not load. Try again.'; refresh(); } }
  }
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  type Profile = HubAccountsSnapshot['profiles'][number];
  /** Every operation first proves the list it was chosen from is still current. */
  async function verify(profile: Profile) {
    const latest = await api.get();
    const target = latest.profiles.find(item => item.id === profile.id);
    if (!target || target.name !== profile.name || latest.current !== snapshot?.current || target.state !== profile.state) { snapshot = latest; refresh(); hub.showRows('Accounts', rows); throw new Error('Accounts changed. Choose from the refreshed list.'); }
  }
  async function open(profile: Profile, mode: HubAccountRequest['mode']) {
    await verify(profile); await api.open({ id: profile.id, mode }); hub.close();
  }
  /**
   * Replacing ends the running game, so it asks first. Its footer primary arms after a moment and
   * ignores a multi-click, so neither the double-click nor the quick second Enter that opened it can pass it.
   */
  function confirmReplace(profile: Profile, title: string, current: string) {
    hub.showView(`Close ${current}?`, (target, back, footer) => {
      const doc = target.ownerDocument;
      // The page itself takes focus, so Enter reaches the named primary once it has armed.
      const view = doc.createElement('section'); view.className = 'hub-detail hub-confirm'; view.tabIndex = 0;
      const heading = doc.createElement('h2'); heading.textContent = `${title}?`;
      view.setAttribute('aria-label', heading.textContent);
      const copy = doc.createElement('p'); copy.textContent = `${profile.name} opens first. Then ${current} saves and closes.`;
      view.append(heading, copy); target.append(view);
      footer.primary({ label: title, destructive: true, armed: true, run: () => open(profile, 'replace') });
      footer.secondary({ label: `Keep ${current}`, run: back });
      return () => view.remove();
    });
  }
  /**
   * Keeping the running game open is row 0 and the default; replacing it comes second and reads
   * as consequential (D-23). The footer names each row's own consequence, never a generic verb.
   */
  const actions = (profile: Profile): HubRow[] => {
    const current = snapshot?.profiles.find(item => item.id === snapshot?.current)?.name ?? 'current account';
    return (['open', 'replace'] as const).map(mode => {
      const title = mode === 'replace' ? `Close ${current} and open ${profile.name}` : `${profile.state === 'running' ? 'Show' : 'Open'} ${profile.name}`;
      return { id: `account:${profile.id}:${mode}`, title,
        detail: mode === 'replace' ? 'Save and close the current game after this account opens' : `Keep ${current} running`,
        group: 'Accounts', action: title, consequential: true, ...(mode === 'replace' ? { destructive: true } : {}),
        run: mode === 'replace' ? async () => { await verify(profile); confirmReplace(profile, title, current); } : () => open(profile, mode) };
    });
  };
  const rows = (): HubRow[] => problem ? [{ id: 'accounts-retry', title: 'Retry accounts', detail: problem, group: 'Accounts', action: 'Retry', run: load }] : !snapshot || snapshot.profiles.length < 2 ? [{ id: 'accounts-manage', title: 'Manage accounts', detail: snapshot ? 'Add another account in the launcher.' : 'Loading accounts…', group: 'Accounts', action: 'Show Launcher', ...(!api.manage ? { unavailable: 'Open the launcher to manage accounts.' } : {}), run: async () => { await api.manage?.(); hub.close(); } }] : snapshot.profiles.map(profile => ({
    id: `account:${profile.id}`, title: profile.name, detail: profile.id === snapshot?.current ? 'Current account' : profile.state === 'running' ? 'Open' : profile.state === 'ready' ? 'Saved account' : profile.state === 'failed' ? 'Retry opening' : 'Opening…',
    group: 'Accounts', action: 'Choose account action',
    ...(profile.id === snapshot?.current || !['ready', 'failed', 'running'].includes(profile.state) ? { unavailable: profile.id === snapshot?.current ? 'Current account' : 'This account is still opening.' } : {}),
    navigate: () => hub.showRows(profile.name, () => actions(profile)), run: () => hub.showRows(profile.name, () => actions(profile)),
  }));
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) {
      if (next && !visible) void load();
      visible = next;
    },
    search(query) {

      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'acc') return [];
      if (parsed.scope === 'acc') {
        const matched = rows().filter(row => hubMatch(row.title, parsed.term) !== null);
        const exact = matched.filter(row => normaliseHubQuery(row.title) === parsed.term && !row.unavailable);
        if (exact.length === 1) {
          const profile = snapshot?.profiles.find(item => `account:${item.id}` === exact[0]?.id);
          if (profile) return actions(profile);
        }
        return matched;
      }
      if (query && hubMatch('Switch Account', query, ['acc', 'accounts']) === null) return [];
      return [{ id: 'accounts', title: 'Switch Account', detail: 'Open another saved account or switch to it', group: 'Tools', action: 'Browse accounts', navigate: () => hub.showRows('Accounts', rows), run: () => hub.showRows('Accounts', rows) }];
    },
  };
}
