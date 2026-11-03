/**
 * The launcher's Guide: the website's player guide pages, built into the app so
 * the Guide matches this version and works offline. The website renders the
 * same Markdown, so a page is written once in apps/website/content.
 *
 * Links become action IDs the Help page resolves: `guide:<page>#<anchor>`,
 * `settings:<section>[/<control>]`, or `url:<https address>` for the browser.
 */
import { parseMarkdown, type MarkdownBlock } from "@shared/launcher-markdown";
import { parseSettingsTarget, type SettingsTarget } from "@shared/settings-catalogue";
import { LAUNCHER_GUIDE_ORIGINS } from "@shared/launcher-contracts";

const WEBSITE = "https://gwonmac.vercel.app";
const IMAGE_DIRECTORY = "../../website/public";

/**
 * The website pages the Guide shows, by their docs path, grouped as in Help's
 * sidebar. Install, mobile linking and the comparison pages stay on the website:
 * whoever reads this already has the app.
 */
const PAGE_PATHS = {
  "known-issues": "guides/known-issues",
  troubleshooting: "guides/troubleshooting",
  accounts: "features/accounts",
  hub: "features/hub",
  "travel-and-maps": "features/travel-and-maps",
  "chat-and-trade": "features/chat-and-trade",
  inventory: "features/inventory",
  combat: "features/combat",
  templates: "guides/templates",
  appearance: "features/appearance",
  performance: "guides/performance",
  "game-files-and-updates": "features/game-files-and-updates",
} as const;
export type GuidePageId = keyof typeof PAGE_PATHS;
export const GUIDE_PAGE_IDS = Object.keys(PAGE_PATHS) as GuidePageId[];
export const GUIDE_HELP_PAGES: readonly GuidePageId[] = ["known-issues", "troubleshooting"];

export interface GuidePage {
  readonly id: GuidePageId;
  readonly title: string;
  readonly summary: string;
  readonly blocks: readonly MarkdownBlock[];
}

export type GuideAction =
  | Readonly<{ kind: "guide"; page: GuidePageId; anchor?: string }>
  | Readonly<{ kind: "settings"; target: SettingsTarget }>
  | Readonly<{ kind: "url"; url: string }>;

const sources = import.meta.glob<string>("../../website/content/en/1.docs/*/*.md", { query: "?raw", import: "default", eager: true });
const images = import.meta.glob<string>("../../website/public/docs/**/*.{webp,png,jpg}", { query: "?url", import: "default", eager: true });

const isPage = (id: string): id is GuidePageId => (GUIDE_PAGE_IDS as readonly string[]).includes(id);

function frontmatter(source: string): { fields: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source.replace(/\r/gu, ""));
  if (!match) throw new Error("guide page has no frontmatter");
  const fields: Record<string, string> = {};
  let parent = "";
  for (const line of match[1]!.split("\n")) {
    const field = /^(\s*)([\w.-]+):\s*(.*)$/u.exec(line);
    if (!field) continue;
    const key = field[1] ? `${parent}.${field[2]}` : field[2]!;
    if (!field[1]) parent = field[2]!;
    fields[key] = field[3]!.replace(/^"(.*)"$/u, "$1");
  }
  return { fields, body: match[2]! };
}

/** The action a guide link performs, or null when the Guide cannot follow it. */
export function guideLink(href: string, page?: GuidePageId): string | null {
  const [path = "", anchor] = href.split("#");
  if (href.startsWith("settings:")) {
    const [section, control] = href.slice("settings:".length).split("/");
    try {
      parseSettingsTarget(control ? { section, control } : { section });
      return href;
    } catch { return null; }
  }
  if (!path) return anchor && page ? `guide:${page}#${anchor}` : null;
  const docs = /^\$docs\/(.+)$/u.exec(path);
  if (docs) {
    const guide = GUIDE_PAGE_IDS.find((id) => PAGE_PATHS[id] === docs[1]);
    if (guide) return `guide:${guide}${anchor ? `#${anchor}` : ""}`;
    return `url:${WEBSITE}/docs/${docs[1]}${anchor ? `#${anchor}` : ""}`;
  }
  const url = path.startsWith("/") ? new URL(href, WEBSITE) : URL.canParse(href) ? new URL(href) : null;
  return url && url.protocol === "https:" && LAUNCHER_GUIDE_ORIGINS.has(url.origin) ? `url:${url.href}` : null;
}

export function parseGuideAction(actionId: string): GuideAction | null {
  if (actionId.startsWith("url:")) return { kind: "url", url: actionId.slice(4) };
  if (actionId.startsWith("settings:")) {
    const [section, control] = actionId.slice("settings:".length).split("/");
    return { kind: "settings", target: parseSettingsTarget(control ? { section, control } : { section }) };
  }
  const guide = /^guide:([\w-]+)(?:#(.+))?$/u.exec(actionId);
  if (guide && isPage(guide[1]!)) return guide[2] ? { kind: "guide", page: guide[1], anchor: guide[2] } : { kind: "guide", page: guide[1] };
  return null;
}

/** The page's Markdown as the website stores it. */
export function guideSource(id: GuidePageId): string {
  // `features/hub` is 1.docs/<n>.features/<n>.hub.md: the website drops the order prefixes.
  const path = Object.keys(sources).find((candidate) => candidate.replace(/^.*1\.docs\//u, "").replace(/(^|\/)\d+\./gu, "$1") === `${PAGE_PATHS[id]}.md`);
  if (!path) throw new Error(`guide page ${id} is missing`);
  return sources[path]!;
}

function page(id: GuidePageId): GuidePage {
  const { fields, body } = frontmatter(guideSource(id));
  return {
    id,
    title: fields["navigation.title"] || fields.title!,
    summary: fields.description ?? "",
    blocks: parseMarkdown(body, {
      link: (href) => guideLink(href, id),
      image: (src) => images[`${IMAGE_DIRECTORY}${src}`] ?? null,
    }, 200),
  };
}

export const GUIDE_PAGES: readonly GuidePage[] = GUIDE_PAGE_IDS.map(page);
