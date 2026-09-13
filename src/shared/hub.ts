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
  action: string;
  preview?: string;
  skills?: readonly Readonly<{ name: string; iconUrl: string | null; elite: boolean }>[];
  attributes?: readonly Readonly<{ name: string; icon: string; attributes: readonly Readonly<{ name: string; label: string; rank: number }>[] }>[];
  attributeStatus?: string;
  professions?: readonly Readonly<{ name: string; icon: string; code: string }>[];
  /** Opens a read-only child page; Right Arrow must never apply a build. */
  navigate?(): void;
  searchQuery?: string;
  icon?: string;
  quoteBasis?: Readonly<{ value:string; options:readonly {value:string;label:string}[]; choose(value:string):void }>;
  conversion?: Readonly<{ input: string; from: string; to: string; iconFrom?: string; iconTo?: string }>;
  unavailable?: string;
  actions?(): void;
  run(): void | Promise<void>;
}>;
export type HubSource = Readonly<{
  feature?: 'characterSwitchEnabled' | 'buildLibrary' | 'travelPalette' | 'tradeChat' | 'whispersEnabled';
  search(query: string): readonly HubRow[];
  /** Read-only current context for Home; never an executable result. */
  context?(): string | null;
  shortcuts?: Readonly<{ get(): readonly HubShortcut[]; save(value: readonly HubShortcut[]): Promise<void> }>;
  lookup?(id: string): HubRow | undefined;
  setVisible(visible: boolean): void;
  subscribe(refresh: () => void): () => void;
}>;

export const normaliseHubQuery = (value: string): string => value.toLowerCase().trim().replace(/\s+/gu, ' ');
export const HUB_SCOPES = ['team', 'build', 'travel', 'char', 'whisper', 'trade', 'acc'] as const;
export type HubScope = typeof HUB_SCOPES[number];
export function parseHubQuery(value: string): { scope: HubScope | null; term: string } {
  const query = normaliseHubQuery(value);
  const [first, ...rest] = query.split(' ');
  const scopes: readonly string[] = HUB_SCOPES;
  return scopes.includes(first ?? '') && rest.length > 0
    ? { scope: first as HubScope, term: rest.join(' ') }
    : { scope: null, term: query };
}
export function hubMatch(name: string, query: string, aliases: readonly string[] = []): 'exact' | 'prefix' | null {
  const term = normaliseHubQuery(query);
  const names = [name, ...aliases].map(normaliseHubQuery);
  if (names.includes(term)) return 'exact';
  if (!term || term.split(' ').every(token => names.some(name => name.split(' ').some(word => word.startsWith(token))))) return 'prefix';
  return null;
}
export function matchHubRows(rows: readonly HubRow[], query: string): readonly HubRow[] {
  if (!normaliseHubQuery(query)) return rows;
  const rank = (row: HubRow) => hubMatch(row.title, query, row.aliases) === 'exact' ? 0 : 1;
  return rows.filter(row => hubMatch(row.title, query, [...(row.aliases ?? []), row.keywords ?? '']) !== null)
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export type HubSummary = Readonly<Pick<HubRow, 'title' | 'detail' | 'skills' | 'attributes' | 'professions' | 'attributeStatus'> & { label: string }>;

export interface HubPresenter<Target> {
  close(): void;
  attach(source: HubSource): () => void;
  showRows(title: string, rows: () => readonly HubRow[], summary?: HubSummary): void;
  showView(title: string, mount: (target: Target, back: () => void) => () => void, available?: () => boolean): void;
}
