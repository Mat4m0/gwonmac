/**
 * Owns account activation from a game window's Hub.
 * The current account is resolved by main; a failed launch never closes it.
 */
import type { AccountMenuActions } from './window-menu.js';
import type { ProfileId } from '../shared/multiple-accounts.js';
import type { HubAccountRequest, HubAccountsSnapshot } from '../shared/accounts-contracts.js';
const pending = new Set<ProfileId>();
export function hubAccountSnapshot(accounts: AccountMenuActions, current: ProfileId): HubAccountsSnapshot {
  return { current, profiles: accounts.profiles().filter(profile => !profile.archived).map(({ id, name, state }) => ({ id, name, state })) };
}
export async function activateHubAccount(accounts: AccountMenuActions, current: ProfileId, request: HubAccountRequest, closeCurrent: () => Promise<void>): Promise<void> {
  if (pending.has(current)) throw new Error('An account is already opening.');
  const target = accounts.profiles().find(profile => profile.id === request.id && !profile.archived);
  if (!target || target.id === current) throw new Error('Choose another saved account.');
  if (!['ready', 'failed', 'running'].includes(target.state)) throw new Error('This account is still opening.');
  pending.add(current);
  try {
    await accounts.activate(target.id);
    const opened = accounts.profiles().find(profile => profile.id === target.id && !profile.archived);
    if (opened?.state !== 'running') throw new Error('The account did not open. Your current account stays open.');
    if (request.mode === 'replace') await closeCurrent();
  } finally { pending.delete(current); }
}
