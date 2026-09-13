/**
 * Presents saved account choices through the native account owner.
 * Search never opens or closes a game window; each operation is explicit.
 */
import { hubMatch, normaliseHubQuery, parseHubQuery, type HubPresenter, type HubRow, type HubSource } from '../shared/hub.js';
import type { HubAccountsSnapshot, HubAccountRequest } from '../shared/accounts-contracts.js';
export function createHubAccounts(hub: HubPresenter<HTMLElement>, api: { get(): Promise<HubAccountsSnapshot>; open(request: HubAccountRequest): Promise<void> }): HubSource {
  let snapshot: HubAccountsSnapshot | null = null;
  let visible = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  const refresh = () => { for (const listener of listeners) listener(); };
  type Profile = HubAccountsSnapshot['profiles'][number];
  const actions = (profile: Profile): HubRow[] => {
    const current = snapshot?.profiles.find(item => item.id === snapshot?.current);
    return (['replace', 'open'] as const).map(mode => ({
      id: `account:${profile.id}:${mode}`, title: mode === 'replace' ? `Close ${current?.name ?? 'current account'} and open ${profile.name}` : `${profile.state === 'running' ? 'Show' : 'Open'} ${profile.name}`,
      detail: mode === 'replace' ? 'Save and close the current game after this account opens' : `Keep ${current?.name ?? 'current account'} running`,
      group: 'Accounts', action: mode === 'replace' ? 'Switch account' : profile.state === 'running' ? 'Show account' : 'Open account',
      run: async () => {
        const latest = await api.get();
        const target = latest.profiles.find(item => item.id === profile.id);
        if (!target || target.name !== profile.name || latest.current !== snapshot?.current || target.state !== profile.state) { snapshot = latest; refresh(); hub.showRows('Accounts', rows); throw new Error('Accounts changed. Choose from the refreshed list.'); }
        await api.open({ id: profile.id, mode }); hub.close();
      },
    }));
  };
  const rows = (): HubRow[] => (snapshot?.profiles ?? []).map(profile => ({
    id: `account:${profile.id}`, title: profile.name, detail: profile.id === snapshot?.current ? 'Current account' : profile.state === 'running' ? 'Open' : profile.state === 'ready' ? 'Saved account' : profile.state === 'failed' ? 'Retry opening' : 'Opening…',
    group: 'Accounts', action: 'Choose account action',
    ...(profile.id === snapshot?.current || !['ready', 'failed', 'running'].includes(profile.state) ? { unavailable: profile.id === snapshot?.current ? 'Current account' : 'This account is still opening.' } : {}),
    run: () => hub.showRows(profile.name, () => actions(profile)),
  }));
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) {
      if (next && !visible) {
        const request = ++generation;
        void api.get().then(value => { if (generation === request) { snapshot = value; refresh(); } }).catch(() => { if (generation === request) { snapshot = null; refresh(); } });
      }
      visible = next;
    },
    search(query) {
      if (!snapshot || snapshot.profiles.length < 2) return [];
      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'acc') return [];
      if (parsed.scope === 'acc') {
        const matched = rows().filter(row => hubMatch(row.title, parsed.term) !== null);
        const exact = matched.filter(row => normaliseHubQuery(row.title) === parsed.term && !row.unavailable);
        if (exact.length === 1) {
          const profile = snapshot.profiles.find(item => `account:${item.id}` === exact[0]?.id);
          if (profile) return actions(profile);
        }
        return matched;
      }
      if (query && hubMatch('Switch Account', query, ['acc', 'accounts']) === null) return [];
      return [{ id: 'accounts', title: 'Switch Account', detail: 'Open another saved account or switch to it', group: 'Tools', action: 'Browse accounts', run: () => hub.showRows('Accounts', rows) }];
    },
  };
}
