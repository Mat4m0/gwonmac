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
  /**
   * Opens a read-only child page; Right Arrow must never apply a build. The task binds a child
   * page that loads first to the page that asked for it, so a late read never opens it (HUB-004).
   */
  navigate?(task: HubTask): void;
  searchQuery?: string;
  icon?: string;
  quoteBasis?: Readonly<{ value:string; options:readonly {value:string;label:string}[]; choose(value:string):void }>;
  conversion?: Readonly<{ input: string; from: string; to: string; iconFrom?: string; iconTo?: string }>;
  unavailable?: string;
  /** Opens the canonical saved record in its existing authoring workspace. */
  workspace?(): void;
  /** A second way into this row; its Actions menu lists it when `actionsLabel` names it. */
  actions?(): void;
  actionsLabel?: string;
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

/**
 * Lower case, single spaces, and typographic apostrophes and dashes folded to their plain
 * forms, so `Lion’s Arch` and `Lion's Arch` are one name (HUB-143). Diacritics stay.
 */
export const normaliseHubQuery = (value: string): string => value.toLowerCase().replace(/[’‘ʼ]/gu, "'").replace(/[‐‑‒–—]/gu, '-').trim().replace(/\s+/gu, ' ');
export const HUB_SCOPES = ['team', 'build', 'travel', 'char', 'whisper', 'invite', 'trade', 'acc'] as const;
export type HubScope = typeof HUB_SCOPES[number];
/** The other words players use for a scope (HUB-142); a closed list, so no phrase becomes a scope by accident. */
const HUB_SCOPE_ALIASES: Readonly<Record<string, HubScope>> = { teams: 'team', builds: 'build', tp: 'travel', character: 'char', characters: 'char', account: 'acc', accounts: 'acc' };
/**
 * `term` is normalised for matching; `text` keeps the typed capitalisation, e.g. for a character name.
 * A scope word followed by a space enters its scope with an empty term; a lone word is still a search.
 */
export function parseHubQuery(value: string): { scope: HubScope | null; term: string; text: string } {
  const words = value.trim().split(/\s+/u);
  const first = words[0]!.toLowerCase();
  const scope = HUB_SCOPES.find(candidate => candidate === first) ?? HUB_SCOPE_ALIASES[first] ?? null;
  const scoped = (words.length > 1 || /\S\s+$/u.test(value)) && scope !== null;
  const text = (scoped ? words.slice(1) : words).join(' ');
  return { scope: scoped ? scope : null, term: normaliseHubQuery(text), text };
}
/** A name's words for matching, with punctuation trimmed from their edges: `(pre-Searing)` is `pre-searing` (HUB-143). */
const hubWords = (name: string) => name.split(' ').map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
/**
 * How well a row answers a query, best first: 0 its name or an alias is the query, 1 its name
 * starts with the query, 2 every query word starts one of its words, 3 only its keywords match.
 * null is no match. Hub search orders sections and rows by this one tier (HUB-008, HUB-058).
 */
export type HubTier = 0 | 1 | 2 | 3;
export function hubTier(row: Readonly<{ title: string; aliases?: readonly string[] | undefined; keywords?: string | undefined }>, query: string): HubTier | null {
  const term = normaliseHubQuery(query);
  const names = [row.title, ...(row.aliases ?? [])].map(normaliseHubQuery);
  if (!term) return 3;
  if (names.includes(term)) return 0;
  if (names.some(name => name.startsWith(term))) return 1;
  const tokens = term.split(' ');
  const words = (candidates: readonly string[]) => candidates.flatMap(hubWords);
  const everyStarts = (candidates: readonly string[]) => { const all = words(candidates); return tokens.every(token => all.some(word => word.startsWith(token))); };
  if (everyStarts(names)) return 2;
  if (row.keywords && everyStarts([...names, normaliseHubQuery(row.keywords)])) return 3;
  return null;
}
export function hubMatch(name: string, query: string, aliases: readonly string[] = []): 'exact' | 'prefix' | null {
  const tier = hubTier({ title: name, aliases }, query);
  return tier === 0 ? 'exact' : tier === null ? null : 'prefix';
}
/** Best tier first; `ordered` keeps a meaningful source order, such as the character selector, within a tier. */
export function matchHubRows(rows: readonly HubRow[], query: string, ordered = false): readonly HubRow[] {
  if (!normaliseHubQuery(query)) return rows;
  const tiers = new Map(rows.map(row => [row, row.matches ? row.matches(query) ? hubTier(row, query) ?? 3 : null : hubTier(row, query)]));
  return rows.filter(row => tiers.get(row) !== null)
    .sort((a, b) => tiers.get(a)! - tiers.get(b)! || (ordered ? 0 : a.title.localeCompare(b.title) || a.id.localeCompare(b.id)));
}

export type HubSummary = Readonly<Pick<HubRow, 'title' | 'detail' | 'skills' | 'attributes' | 'professions' | 'attributeStatus' | 'folder' | 'workspace'> & { label: string }>;

/** One footer action of a mounted view. `armed` holds a destructive primary until it has armed (~400 ms). */
export type HubViewAction = Readonly<{ label: string; run(task: HubTask): void | Promise<void>; disabled?: boolean; destructive?: boolean; armed?: boolean }>;
/**
 * The Hub footer stays in every view and names what Enter does there. A view sets its named
 * primary (Enter outside a control) and a secondary in Actions; without a primary it reads "Done" and goes
 * back. A view opens the shared Actions menu for its selected item with `openActions()`.
 * Legacy embedded footers remain until their owning branch completes the cutover.
 */
export type HubViewFooter = Readonly<{ primary(action: HubViewAction | null): void; secondary(action: HubViewAction | null): void; openActions(): void; own(): void }>;
export type HubViewMount<Target> = (target: Target, back: () => void, footer: HubViewFooter) => () => void;

/**
 * A page a direct shortcut opens (⌘T, ⌘E, ⌘B, Settings) or an action returns to (Accounts);
 * every route to it names it, so `direct` finds it.
 */
export type HubDestination = 'travel' | 'characters' | 'builds' | 'settings' | 'accounts';

export interface HubPresenter<Target> {
  close(): void;
  /** A named outcome with no running task behind it; a failure also waits in the status line of the next opening. */
  notify(message: string, outcome?: 'failed'): void;
  attach(source: HubSource): () => void;
  showRows(title: string, rows: () => readonly HubRow[], summary?: HubSummary, destination?: HubDestination): void;
  showView(title: string, mount: HubViewMount<Target>, available?: () => boolean, destination?: HubDestination): void;
  /** Whether Esc on an empty query goes back to a parent page rather than closing the Hub. */
  readonly hasParent?: boolean;
}
