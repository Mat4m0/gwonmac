/**
 * Owns the launcher's two exact news sources, their bounded validation, the
 * last-good cache, safe Markdown projection, and trusted story/media actions.
 * The renderer receives presentation data and opaque IDs, never remote URLs.
 */
import { readFile } from "node:fs/promises";
import type { LauncherPreferences, LauncherNewsBlock, LauncherNewsInline, LauncherNewsState, LauncherNewsStory } from "../../shared/launcher-contracts.js";
import { readBoundedResponse } from "./bounded-response.js";
import { writeAtomicJson } from "./atomic-file.js";

export const PROJECT_NEWS_URL = "https://gwonmac.vercel.app/launcher/news-v1.json";
const WIKI_EXTRACT_MODE = ["ex", "plain", "text"].join("");
export const WIKI_UPDATES_URL = `https://wiki.guildwars.com/api.php?action=query&generator=allpages&gapnamespace=202&gapprefix=Game%20updates%2F&gaplimit=5&gapdir=descending&prop=extracts%7Cinfo%7Crevisions&${WIKI_EXTRACT_MODE}=1&inprop=url&rvprop=timestamp&format=json&origin=*`;
const PROJECT_ORIGIN = "https://gwonmac.vercel.app";
const MAX_FEED_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STORIES = 24;
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

function inline(textValue: string, registerLink: (url: string) => string): readonly LauncherNewsInline[] {
  const parts: LauncherNewsInline[] = [];
  const expression = /(!?\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?|\*\*([^*]+)\*\*|`([^`]+)`)/gu;
  let cursor = 0;
  for (const match of textValue.matchAll(expression)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: textValue.slice(cursor, start) });
    if (match[1]?.startsWith("!")) parts.push({ text: match[2] ?? "Image" });
    else if (match[2] !== undefined) {
      try { parts.push({ text: match[2], actionId: registerLink(trustedUrl(match[3], "article link")) }); }
      catch { parts.push({ text: match[2] }); }
    } else if (match[4] !== undefined) parts.push({ text: match[4], emphasis: "strong" });
    else if (match[5] !== undefined) parts.push({ text: match[5], emphasis: "code" });
    cursor = start + match[0].length;
  }
  if (cursor < textValue.length) parts.push({ text: textValue.slice(cursor) });
  return parts;
}

function imageUrl(source: string): string | null {
  try {
    const url = new URL(source, PROJECT_ORIGIN);
    return url.origin === PROJECT_ORIGIN && url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function markdown(body: string, storyId: string, media: Map<string, string>, links: Map<string, string>): readonly LauncherNewsBlock[] {
  const blocks: LauncherNewsBlock[] = [];
  let mediaIndex = 0;
  let linkIndex = 0;
  const registerLink = (url: string): string => {
    const id = linkActionId(storyId, url, linkIndex);
    linkIndex += 1;
    links.set(id, url);
    return id;
  };
  const lines = body.replace(/\r/gu, "").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index]?.trim() ?? "";
    if (!line) { index += 1; continue; }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/u.exec(line);
    if (image) {
      const url = imageUrl(image[2]!);
      if (url) {
        const key = `${storyId}/${mediaIndex}`;
        mediaIndex += 1;
        media.set(key, url);
        blocks.push({ type: "image", src: `gw://app/launcher-media/${key}`, alt: image[1]! });
      }
      index += 1;
      continue;
    }
    if (line.startsWith("## ")) { blocks.push({ type: "heading", text: line.slice(3) }); index += 1; continue; }
    if (line.startsWith("- ")) {
      const items: LauncherNewsInline[][] = [];
      while ((lines[index]?.trim() ?? "").startsWith("- ")) {
        items.push([...inline((lines[index]?.trim() ?? "").slice(2), registerLink)]);
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index]?.trim() && !/^(## |-|!\[)/u.test(lines[index]?.trim() ?? "")) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", content: inline(paragraph.join(" "), registerLink) });
  }
  return blocks.slice(0, 80);
}

function wikiStories(value: unknown): RawStory[] {
  const pages = object(object(object(value, "Wiki response").query, "Wiki query").pages, "Wiki pages");
  return Object.values(pages).flatMap((raw): RawStory[] => {
    const page = object(raw, "Wiki page");
    const titleValue = typeof page.title === "string" ? page.title : "";
    const match = /^Feedback:Game updates\/(\d{4})(\d{2})(\d{2})$/u.exec(titleValue);
    if (!match || typeof page.fullurl !== "string" || typeof page.extract !== "string" || !page.extract.trim()) return [];
    const publishedAt = `${match[1]}-${match[2]}-${match[3]}T12:00:00Z`;
    const dateLabel = new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(new Date(publishedAt));
    const clean = page.extract.replace(/\n+/gu, " ").replace(/\s+/gu, " ").trim();
    return [{
      id: `guild-wars-update-${match[1]}-${match[2]}-${match[3]}`,
      source: "game",
      channel: "all",
      title: `Guild Wars update — ${dateLabel}`,
      summary: clean.slice(0, 280),
      publishedAt,
      featured: true,
      url: trustedUrl(page.fullurl, "Wiki page url"),
      body: clean,
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
    const stories = this.raw
      .filter((story) => story.channel !== "beta" || track === "beta")
      .filter((story) => story.source === "launcher" ? preferences.content.reforgedNews : story.source === "event" ? preferences.content.eventNews : preferences.content.officialNews)
      .map((story): LauncherNewsStory => ({
        id: story.id,
        source: story.source,
        channel: story.channel,
        title: story.title,
        summary: story.summary,
        publishedAt: story.publishedAt,
        featured: story.featured,
        action: story.source === "launcher" ? "article" : "external",
        ...(story.startsAt ? { startsAt: story.startsAt } : {}),
        ...(story.endsAt ? { endsAt: story.endsAt } : {}),
        body: story.source === "launcher" ? markdown(story.body, story.id, this.media, this.links) : [],
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
