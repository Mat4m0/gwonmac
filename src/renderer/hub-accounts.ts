/**
 * Presents saved account choices through the native account owner.
 * Search never opens or closes a game window; each operation is explicit, and
 * closing the running game passes an armed confirmation first.
 */
import { hubMatch, normaliseHubQuery, parseHubQuery, type HubDestination, type HubPresenter, type HubRow, type HubSource, type HubTask } from '../shared/hub.js';
import type { HubAccountsSnapshot, HubAccountRequest } from '../shared/accounts-contracts.js';
type AccountsHub = HubPresenter<HTMLElement> & { direct(destination: HubDestination, open: () => void): void };
export function createHubAccounts(hub: AccountsHub, api: { get(): Promise<HubAccountsSnapshot>; open(request: HubAccountRequest): Promise<void>; manage?(): Promise<void> }): HubSource {
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
  const showAccounts = () => hub.showRows('Accounts', rows, undefined, 'accounts');
  /**
   * Every operation first proves the list it was chosen from is still current. A stale list
   * returns to the Accounts page the choice came from, rebuilt from the latest list, so Back
   * never reaches the stale actions (HUB-174). Without that page, `leave` first steps out of a
   * stale confirmation, and Accounts opens over its parent. A late check never navigates.
   */
  async function verify(profile: Profile, task: HubTask, leave?: () => void) {
    const latest = await api.get();
    const target = latest.profiles.find(item => item.id === profile.id);
    if (!target || target.name !== profile.name || latest.current !== snapshot?.current || target.state !== profile.state) {
      snapshot = latest; refresh();
      if (task.live()) hub.direct('accounts', () => { leave?.(); showAccounts(); });
      throw new Error('Accounts changed. Choose from the refreshed list.');
    }
  }
  async function open(profile: Profile, mode: HubAccountRequest['mode'], task: HubTask, leave?: () => void) {
    await verify(profile, task, leave); await api.open({ id: profile.id, mode }); task.done();
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
      footer.primary({ label: title, destructive: true, armed: true, run: task => open(profile, 'replace', task, back) });
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
        // Opening waits until the new window runs; the footer and status name it meanwhile (HUB-083).
        pending: mode === 'replace' ? { label: `Checking ${profile.name}…`, again: `${profile.name} is still being checked.` }
          : { label: `${profile.state === 'running' ? 'Showing' : 'Opening'} ${profile.name}…`, again: `${profile.name} is still opening.` },
        run: mode === 'replace' ? async task => { await verify(profile, task); if (task.live()) confirmReplace(profile, title, current); } : task => open(profile, mode, task) };
    });
  };
  const rows = (): HubRow[] => {
    const list = snapshot;
    if (problem) return [{ id: 'accounts-retry', title: 'Retry accounts', detail: problem, group: 'Accounts', action: 'Retry', run: load }];
    // Loading runs nothing, so Enter never opens the Launcher before the accounts are known (HUB-232).
    if (!list) return [{ id: 'accounts-loading', title: 'Loading accounts…', detail: '', group: 'Accounts', action: 'Loading', unavailable: 'Accounts are still loading.', run() {} }];
    if (list.profiles.length < 2) return [{ id: 'accounts-manage', title: 'Manage accounts', detail: 'Add another account in the launcher.', group: 'Accounts', action: 'Show Launcher', ...(!api.manage ? { unavailable: 'Open the launcher to manage accounts.' } : {}), run: async task => { await api.manage?.(); task.done(); } }];
    return list.profiles.map(profile => {
      const unavailable = profile.id === list.current ? 'Current account' : !['ready', 'failed', 'running'].includes(profile.state) ? 'This account is still opening.' : null;
      const choose = () => hub.showRows(profile.name, () => actions(profile));
      return { id: `account:${profile.id}`, title: profile.name, detail: profile.id === list.current ? 'Current account' : profile.state === 'running' ? 'Open' : profile.state === 'ready' ? 'Saved account' : profile.state === 'failed' ? 'Retry opening' : 'Opening…',
        group: 'Accounts', action: 'Choose account action',
        // → follows the same availability as Enter: the current account has no actions to open (HUB-175).
        ...(unavailable ? { unavailable } : { navigate: choose }), run: choose };
    });
  };
  const accountRow = (): HubRow => ({ id: 'accounts', title: 'Switch Account', detail: 'Open another saved account or switch to it', group: 'Tools', action: 'Browse accounts', navigate: showAccounts, run: showAccounts });
  return {
    lookup: id => id === 'accounts' ? accountRow() : undefined,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisible(next) {
      if (next && !visible) void load();
      visible = next;
    },
    search(query) {
      const parsed = parseHubQuery(query);
      if (parsed.scope && parsed.scope !== 'acc') return [];
      if (parsed.scope === 'acc') {
        // A failed read answers every account search with its retry, never "No matches" (HUB-233).
        if (problem) return rows();
        const matched = rows().filter(row => hubMatch(row.title, parsed.term) !== null);
        const exact = matched.filter(row => normaliseHubQuery(row.title) === parsed.term && !row.unavailable);
        if (exact.length === 1) {
          const profile = snapshot?.profiles.find(item => `account:${item.id}` === exact[0]?.id);
          if (profile) return actions(profile);
        }
        return matched;
      }
      if (query && hubMatch('Switch Account', query, ['acc', 'accounts']) === null) return [];
      return [accountRow()];
    },
  };
}
