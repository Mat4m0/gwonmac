/**
 * Defines local search rows and presentation contracts for Hub.
 * These contracts expose no IPC or persisted state.
 */
import type { HubShortcut } from "./hub-preferences.js";
export type HubRow = Readonly<{
  id: string;
  title: string;
  detail: string;
  group: string;
  keywords?: string;
  aliases?: readonly string[];
  /** A domain-specific matcher shared by global search and scoped browsing. */
  matches?(query: string): boolean;
  action: string;
  /** Preferred initial browse focus, without affecting explicit user selection. */
  preferred?: boolean;
  /** The primary changes the game or the account: travel, invite, apply, switch or account (D-24). Never selected on a guess. */
  consequential?: boolean;
  /** The primary ends something the player cannot take back (closing the running account); styled as such. */
  destructive?: boolean;
  /** The primary travels out of an explorable area; a fresh Home never preselects it (D-13). */
  leavesArea?: boolean;
  preview?: string;
  skills?: readonly Readonly<{ name: string; iconUrl: string | null; elite: boolean; description?: string | null; changed?: boolean }>[];
  attributes?: readonly Readonly<{ name: string; icon: string; attributes: readonly Readonly<{ name: string; label: string; rank: number; nextRank?: number }>[] }>[];
  attributeStatus?: string;
  folder?: string | null;
  professions?: readonly Readonly<{ name: string; icon: string; code: string }>[];
  /** Opens a read-only child page; Right Arrow must never apply a build. */
  navigate?(): void;
  searchQuery?: string;
  icon?: string;
  quoteBasis?: Readonly<{ value:string; options:readonly {value:string;label:string}[]; choose(value:string):void }>;
  conversion?: Readonly<{ input: string; from: string; to: string; iconFrom?: string; iconTo?: string }>;
  unavailable?: string;
  /** Opens the canonical saved record in its existing authoring workspace. */
  workspace?(): void;
  actions?(): void;
  /** How the footer and a repeated Enter name this row's action while it runs (HUB-083). */
  pending?: Readonly<{ label: string; again: string }>;
  run(task: HubTask): void | Promise<void>;
}>;
/**
 * A running row or view action's link to the Hub page that started it (HUB-004). That page's
 * session ends when the player types, navigates, closes or suspends the Hub. The action keeps
 * running, but from then on it never navigates or closes the Hub: its outcome becomes a receipt.
 * A thrown error is the named failure; after the session ended it is a failure receipt (HUB-016).
 */
export type HubTask = Readonly<{
  /** The page and query the action started from are still showing. */
  live(): boolean;
  /** Named progress in the status line while the page is live, e.g. "Applying GOM AFK… 5/16". */
  progress(message: string): void;
  /** The task ended: a live page closes the Hub with the receipt; otherwise the receipt reports it. */
  done(receipt?: string): void;
}>;
export type HubSource = Readonly<{
  feature?: 'characterSwitchEnabled' | 'buildLibrary' | 'travelPalette' | 'tradeChat' | 'whispersEnabled';
  search(query: string): readonly HubRow[];
  /** Read-only current context for Home; never an executable result. */
  context?(): string | null;
  /** One quiet line on what the game state holds back, e.g. "Map loading — …" (D-26); never an executable result. */
  lifecycle?(): string | null;
  shortcuts?: Readonly<{ get(): readonly HubShortcut[]; save(value: readonly HubShortcut[]): Promise<void> }>;
  lookup?(id: string): HubRow | undefined;
  setVisible(visible: boolean): void;
  subscribe(refresh: () => void): () => void;
}>;

export const normaliseHubQuery = (value: string): string => value.toLowerCase().trim().replace(/\s+/gu, ' ');
export const HUB_SCOPES = ['team', 'build', 'travel', 'char', 'whisper', 'invite', 'trade', 'acc'] as const;
export type HubScope = typeof HUB_SCOPES[number];
/**
 * `term` is normalised for matching; `text` keeps the typed capitalisation, e.g. for a character name.
 * A scope word followed by a space enters its scope with an empty term; a lone word is still a search.
 */
export function parseHubQuery(value: string): { scope: HubScope | null; term: string; text: string } {
  const words = value.trim().split(/\s+/u);
  const scopes: readonly string[] = HUB_SCOPES;
  const scoped = (words.length > 1 || /\S\s+$/u.test(value)) && scopes.includes(words[0]!.toLowerCase());
  const text = (scoped ? words.slice(1) : words).join(' ');
  return { scope: scoped ? words[0]!.toLowerCase() as HubScope : null, term: normaliseHubQuery(text), text };
}
export function hubMatch(name: string, query: string, aliases: readonly string[] = []): 'exact' | 'prefix' | null {
  const term = normaliseHubQuery(query);
  const names = [name, ...aliases].map(normaliseHubQuery);
  if (names.includes(term)) return 'exact';
  if (!term || term.split(' ').every(token => names.some(name => name.split(' ').some(word => word.startsWith(token))))) return 'prefix';
  return null;
}
/** `ordered` keeps a meaningful source order, such as the character selector, after exact matches. */
export function matchHubRows(rows: readonly HubRow[], query: string, ordered = false): readonly HubRow[] {
  if (!normaliseHubQuery(query)) return rows;
  const rank = (row: HubRow) => hubMatch(row.title, query, row.aliases) === 'exact' ? 0 : 1;
  return rows.filter(row => row.matches ? row.matches(query) : hubMatch(row.title, query, [...(row.aliases ?? []), row.keywords ?? '']) !== null)
    .sort((a, b) => rank(a) - rank(b) || (ordered ? 0 : a.title.localeCompare(b.title) || a.id.localeCompare(b.id)));
}

export type HubSummary = Readonly<Pick<HubRow, 'title' | 'detail' | 'skills' | 'attributes' | 'professions' | 'attributeStatus' | 'folder' | 'workspace'> & { label: string }>;

/** One footer action of a mounted view. `armed` holds a destructive primary until it has armed (~400 ms). */
export type HubViewAction = Readonly<{ label: string; run(task: HubTask): void | Promise<void>; disabled?: boolean; destructive?: boolean; armed?: boolean }>;
/**
 * The Hub footer stays in every view and names what Enter does there. A view sets its named
 * primary (Enter outside a control) and secondary; without one the primary reads "Done" and goes
 * back. Travel and Characters keep their own footer and say so with `own()`.
 */
export type HubViewFooter = Readonly<{ primary(action: HubViewAction | null): void; secondary(action: HubViewAction | null): void; own(): void }>;
export type HubViewMount<Target> = (target: Target, back: () => void, footer: HubViewFooter) => () => void;

export interface HubPresenter<Target> {
  close(): void;
  /** A named outcome with no running task behind it; a failure also waits in the status line of the next opening. */
  notify(message: string, outcome?: 'failed'): void;
  attach(source: HubSource): () => void;
  showRows(title: string, rows: () => readonly HubRow[], summary?: HubSummary): void;
  showView(title: string, mount: HubViewMount<Target>, available?: () => boolean): void;
}
