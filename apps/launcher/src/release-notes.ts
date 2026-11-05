/**
 * The release notes of the installed version, read from its website post at
 * build time, so "What's new" works offline and matches this exact app. The
 * post may still be a draft: the news feed publishes it only at release.
 * Its links are Guide actions (see guide.ts), not news link IDs.
 */
import type { LauncherNewsStory } from "@shared/launcher-contracts";
import { parseMarkdown } from "@shared/launcher-markdown";
import { guideLink } from "./guide";

const posts = import.meta.glob<string>("../../website/content/en/2.blog/*.md", { query: "?raw", import: "default", eager: true });
const images = import.meta.glob<string>("../../website/public/blog/**/*.{webp,png,jpg,gif}", { query: "?url", import: "default", eager: true });

export const releaseStoryId = (version: string) => `gwonmac-${version.replaceAll(".", "-")}`;

export function releaseNotesFor(version: string): LauncherNewsStory | null {
  const id = releaseStoryId(version);
  const source = Object.values(posts).map((post) => post.replace(/\r/gu, "")).find((post) => post.includes(`\nlauncherId: ${id}\n`));
  const match = source && /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source);
  if (!match) return null;
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, "mu").exec(match[1]!)?.[1]?.replace(/^"(.*)"$/u, "$1") ?? "";
  return {
    id,
    source: "launcher",
    channel: field("launcherChannel") === "beta" ? "beta" : "stable",
    title: field("title"),
    summary: field("description"),
    publishedAt: `${field("date")}T12:00:00Z`,
    featured: false,
    action: "article",
    body: parseMarkdown(match[2]!, { link: (href) => guideLink(href), image: (src) => images[`../../website/public${src}`] ?? null }, 200),
  };
}
