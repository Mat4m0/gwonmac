/**
 * Owns the launcher's two exact news sources, their bounded validation, the
 * last-good cache, safe Markdown projection, and trusted story/media actions.
 * The renderer receives presentation data and opaque IDs, never remote URLs.
 */
import { readFile } from "node:fs/promises";
import type { LauncherPreferences, LauncherNewsBlock, LauncherNewsState, LauncherNewsStory } from "../../shared/launcher-contracts.js";
import { parseMarkdown } from "../../shared/launcher-markdown.js";
import { readBoundedResponse } from "./bounded-response.js";
import { writeAtomicJson } from "./atomic-file.js";

export const PROJECT_NEWS_URL = "https://www.gwonmac.com/launcher/news-v1.json";
// The page source, not a plain-text extract: the wiki returns a whole-page extract for only
// one page per request, and the source keeps the bullet lists that update notes are made of.
export const WIKI_UPDATES_URL = "https://wiki.guildwars.com/api.php?action=query&generator=allpages&gapnamespace=202&gapprefix=Game%20updates%2F&gaplimit=5&gapdir=descending&prop=revisions%7Cinfo&rvprop=content%7Ctimestamp&rvslots=main&inprop=url&format=json&origin=*";
const WIKI_ORIGIN = "https://wiki.guildwars.com";
const PROJECT_ORIGIN = "https://www.gwonmac.com";
const MAX_FEED_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STORIES = 24;
const MAX_WIKI_SUMMARY_LENGTH = 280;
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_LINK_ORIGINS = new Set([PROJECT_ORIGIN, "https://wiki.guildwars.com", "https://github.com", "https://discord.gg"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface RawStory {
  id: string;
  source: "launcher" | "event" | "game";
  channel: "all" | "stable" | "beta";
  title: string;
  summary: string;
  publishedAt: string;
  featured: boolean;
  url: string;
  startsAt?: string;
  endsAt?: string;
  body: string;
}

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface LauncherNewsOptions {
  cachePath: string;
  fetch: FetchLike;
  openExternal: (url: string) => Promise<void>;
  now?: () => Date;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`${label} is invalid`);
  return value;
}

function iso(value: unknown, label: string): string {
  const candidate = text(value, label, 40);
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${label} is invalid`);
  return candidate;
}

function trustedUrl(value: unknown, label: string): string {
  const candidate = new URL(text(value, label, 500), PROJECT_ORIGIN);
  if (!ALLOWED_LINK_ORIGINS.has(candidate.origin) || candidate.protocol !== "https:") throw new Error(`${label} is not trusted`);
  return candidate.href;
}

function rawStory(value: unknown): RawStory {
  const source = object(value, "story");
  const id = text(source.id, "story id", 80);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) throw new Error("story id is invalid");
  if (source.source !== "launcher" && source.source !== "event") throw new Error("story source is invalid");
  if (source.channel !== "all" && source.channel !== "stable" && source.channel !== "beta") throw new Error("story channel is invalid");
  if (typeof source.featured !== "boolean") throw new Error("story featured is invalid");
  return {
    id,
    source: source.source,
    channel: source.channel,
    title: text(source.title, "story title", 140),
    summary: text(source.summary, "story summary", 360),
    publishedAt: iso(source.publishedAt, "story publishedAt"),
    featured: source.featured,
    url: trustedUrl(source.url, "story url"),
    ...(source.startsAt === undefined ? {} : { startsAt: iso(source.startsAt, "story startsAt") }),
    ...(source.endsAt === undefined ? {} : { endsAt: iso(source.endsAt, "story endsAt") }),
    body: text(source.body, "story body", 80_000),
  };
}

export function parseProjectNewsFeed(value: unknown): readonly RawStory[] {
  const source = object(value, "news feed");
  if (source.version !== 1 || !Array.isArray(source.stories) || source.stories.length > MAX_STORIES) throw new Error("news feed is invalid");
  const stories = source.stories.map(rawStory);
  if (new Set(stories.map((story) => story.id)).size !== stories.length) throw new Error("news story ids must be unique");
  return stories;
}

function linkActionId(storyId: string, url: string, index: number): string {
  let hash = 2_166_136_261;
  for (const character of `${storyId}\0${url}\0${index}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `news-link-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function imageUrl(source: string): string | null {
  try {
    const url = new URL(source, PROJECT_ORIGIN);
    return url.origin === PROJECT_ORIGIN && url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function markdown(body: string, storyId: string, media: Map<string, string>, links: Map<string, string>): readonly LauncherNewsBlock[] {
  let mediaIndex = 0;
  let linkIndex = 0;
  return parseMarkdown(body, {
    link: (href) => {
      let url: string;
      try { url = trustedUrl(href, "article link"); } catch { return null; }
      const id = linkActionId(storyId, url, linkIndex);
      linkIndex += 1;
      links.set(id, url);
      return id;
    },
    image: (source) => {
      const url = imageUrl(source);
      if (!url) return null;
      const key = `${storyId}/${mediaIndex}`;
      mediaIndex += 1;
      media.set(key, url);
      return `gw://app/launcher-media/${key}`;
    },
  });
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const candidate = value.slice(0, maxLength - 1);
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > 0 ? lastSpace : undefined).trimEnd()}…`;
}

/**
 * Wiki update notes as the launcher's Markdown subset: headings, bullets (nested
 * bullets flatten), bold, and links to wiki articles. Templates, tags, files and
 * categories are dropped; the wiki's own editorial notes section is left out.
 */
export function wikitextToMarkdown(source: string): string {
  const article = (title: string) => `${WIKI_ORIGIN}/wiki/${encodeURIComponent(title.trim().replace(/ /gu, "_")).replace(/%2F/gu, "/").replace(/\(/gu, "%28").replace(/\)/gu, "%29")}`;
  const lines: string[] = [];
  let skip = false;
  // Like MediaWiki, an unclosed comment runs to the end of the page.
  for (const raw of source.replace(/\r/gu, "").replace(/<noinclude>[\s\S]*?<\/noinclude>|<!--[\s\S]*?(?:-->|$)/gu, "").split("\n")) {
    const heading = /^(={2,6})\s*(.*?)\s*\1\s*$/u.exec(raw.trim());
    if (heading) {
      skip = /^Guild Wars Wiki notes$/iu.test(heading[2]!);
      if (!skip) lines.push("", `${heading[1]!.length === 2 ? "##" : "###"} ${heading[2]}`, "");
      continue;
    }
    if (skip) continue;
    let line = raw
      .replace(/\{\{\s*skill icon\s*\|([^|}]+)[^}]*\}\}/giu, "$1")
      .replace(/\{\{[^{}]*\}\}/gu, "")
      .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/giu, "")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, (_match, title: string, label: string) => `[${label}](${article(title)})`)
      .replace(/\[\[([^\]]+)\]\]/gu, (_match, title: string) => `[${title}](${article(title)})`)
      .replace(/\[(https?:\/\/\S+) ([^\]]+)\]/gu, "$2")
      .replace(/'''(.+?)'''/gu, "**$1**")
      .replace(/''(.+?)''/gu, "$1")
      // A tag can continue on the next line; drop its start up to the line end.
      .replace(/<[^>]*(?:>|$)/gu, "")
      .trim();
    const bullet = /^([*#]+)\s*(.*)$/u.exec(line);
    if (bullet) line = bullet[2] ? `- ${bullet[2]}` : "";
    lines.push(line);
  }
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function wikiSummary(markdown: string): string {
  let section = "";
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{2,3} (.*)$/u.exec(line)?.[1]?.trim();
    if (heading !== undefined) {
      if (!/^Update\b/iu.test(heading)) section = heading;
      continue;
    }
    if (/^Build:\s*/iu.test(line)) continue;
    const text = line.replace(/^- /u, "").replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1").replace(/\*\*/gu, "");
    return truncateAtWord(section ? `${section} — ${text}` : text, MAX_WIKI_SUMMARY_LENGTH);
  }
  return "Read the full update notes on the Guild Wars Wiki.";
}

function wikiStories(value: unknown): RawStory[] {
  const pages = object(object(object(value, "Wiki response").query, "Wiki query").pages, "Wiki pages");
  return Object.values(pages).flatMap((raw): RawStory[] => {
    const page = object(raw, "Wiki page");
    const titleValue = typeof page.title === "string" ? page.title : "";
    const match = /^Feedback:Game updates\/(\d{4})(\d{2})(\d{2})$/u.exec(titleValue);
    const revision = Array.isArray(page.revisions) ? page.revisions[0] as { slots?: { main?: Record<string, unknown> } } | undefined : undefined;
    const source = revision?.slots?.main?.["*"];
    if (!match || typeof page.fullurl !== "string" || typeof source !== "string") return [];
    const body = wikitextToMarkdown(source);
    if (!body) return [];
    const publishedAt = `${match[1]}-${match[2]}-${match[3]}T12:00:00Z`;
    const dateLabel = new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(new Date(publishedAt));
    return [{
      id: `guild-wars-update-${match[1]}-${match[2]}-${match[3]}`,
      source: "game",
      channel: "all",
      title: `Guild Wars update — ${dateLabel}`,
      summary: wikiSummary(body),
      publishedAt,
      featured: true,
      url: trustedUrl(page.fullurl, "Wiki page url"),
      body,
    }];
  });
}

export class LauncherNewsService {
  private readonly options: LauncherNewsOptions;
  private raw: RawStory[] = [];
  private state: "loading" | "ready" | "offline" = "loading";
  private refreshedAt = "";
  private readonly links = new Map<string, string>();
  private readonly media = new Map<string, string>();

  constructor(options: LauncherNewsOptions) { this.options = options; }

  async loadCache(): Promise<void> {
    try {
      this.raw = [...parseProjectNewsFeed(JSON.parse(await readFile(this.options.cachePath, "utf8")) as unknown)];
      this.state = "offline";
    } catch { /* An absent or invalid cache is the honest loading state. */ }
    this.rebuildMaps();
  }

  async refresh(): Promise<void> {
    const fetchJson = async (url: string): Promise<unknown> => {
      const response = await this.options.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`news request failed (${response.status})`);
      return JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, MAX_FEED_BYTES))) as unknown;
    };
    const [projectResult, wikiResult] = await Promise.allSettled([fetchJson(PROJECT_NEWS_URL), fetchJson(WIKI_UPDATES_URL)]);
    const cachedProject = this.raw.filter((story) => story.source !== "game");
    let projectStories = cachedProject;
    let gameStories: RawStory[] = [];
    try {
      if (projectResult.status === "fulfilled") projectStories = [...parseProjectNewsFeed(projectResult.value)];
      if (wikiResult.status === "fulfilled") gameStories = wikiStories(wikiResult.value);
      this.raw = [...gameStories, ...projectStories].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
      if (projectResult.status === "rejected" && wikiResult.status === "rejected") throw new Error("all news sources failed");
      this.state = "ready";
      this.refreshedAt = (this.options.now ?? (() => new Date()))().toISOString();
      if (projectResult.status === "fulfilled") await writeAtomicJson(this.options.cachePath, { version: 1, stories: projectStories }, 0o600);
    } catch {
      this.state = "offline";
    }
    this.rebuildMaps();
  }

  snapshot(track: "stable" | "beta", preferences: LauncherPreferences): LauncherNewsState {
    const now = (this.options.now ?? (() => new Date()))().getTime();
    const stories = this.raw
      .filter((story) => story.channel !== "beta" || track === "beta")
      // A finished event is no longer news; its post stays on the website.
      .filter((story) => !story.endsAt || Date.parse(story.endsAt) > now)
      .filter((story) => story.source === "launcher" ? preferences.content.reforgedNews : story.source === "event" ? preferences.content.eventNews : preferences.content.officialNews)
      .map((story): LauncherNewsStory => ({
        id: story.id,
        source: story.source,
        channel: story.channel,
        title: story.title,
        summary: story.summary,
        publishedAt: story.publishedAt,
        featured: story.featured,
        action: story.body.trim() ? "article" : "external",
        ...(story.startsAt ? { startsAt: story.startsAt } : {}),
        ...(story.endsAt ? { endsAt: story.endsAt } : {}),
        body: markdown(story.body, story.id, this.media, this.links),
      }));
    if (this.state === "ready") return { status: "ready", stories, refreshedAt: this.refreshedAt };
    return { status: this.state, stories };
  }

  async open(id: string): Promise<void> {
    const url = this.links.get(id);
    if (!url) throw new Error("news story is unavailable");
    await this.options.openExternal(url);
  }

  async image(key: string): Promise<Response> {
    const url = this.media.get(key);
    if (!url) return new Response("not found", { status: 404 });
    const response = await this.options.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: "image/*" } });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
    if (!response.ok || !IMAGE_TYPES.has(contentType)) return new Response("not found", { status: 404 });
    const bytes = await readBoundedResponse(response, MAX_IMAGE_BYTES);
    return new Response(Uint8Array.from(bytes).buffer, { headers: { "content-type": contentType, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  }

  private rebuildMaps(): void {
    this.links.clear();
    this.media.clear();
    for (const story of this.raw) this.links.set(story.id, story.url);
  }
}
