/**
 * Builds the launcher's small, static news contract from canonical website
 * Markdown. Only posts with launcherId participate; the website remains the
 * authoring and presentation owner while this file is a rebuildable projection.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const contentRoot = path.join(root, "content/en/2.blog");
const outputPath = path.join(root, "public/launcher/news-v1.json");
const check = process.argv.includes("--check");
const allowed = new Set([
  "title", "description", "badge", "date", "readingTime", "author",
  "launcherId", "launcherSource", "launcherChannel", "launcherFeatured",
  "launcherExternalUrl", "launcherStartsAt", "launcherEndsAt",
]);

function frontmatter(source, name) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source);
  if (!match) throw new Error(`${name}: frontmatter is missing`);
  const metadata = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`${name}: unsupported frontmatter line`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key.startsWith("launcher") && !allowed.has(key)) throw new Error(`${name}: unknown launcher frontmatter field ${key}`);
    metadata[key] = value;
  }
  return { metadata, body: match[2].trim() };
}

function required(metadata, key, name) {
  const value = metadata[key];
  if (!value) throw new Error(`${name}: ${key} is required for launcher news`);
  return value;
}

function storyFrom(name, source) {
  const { metadata, body } = frontmatter(source, name);
  if (!metadata.launcherId) return null;
  const itemSource = required(metadata, "launcherSource", name);
  const channel = required(metadata, "launcherChannel", name);
  if (!["launcher", "event"].includes(itemSource)) throw new Error(`${name}: launcherSource is invalid`);
  if (!["all", "stable", "beta"].includes(channel)) throw new Error(`${name}: launcherChannel is invalid`);
  if (metadata.launcherFeatured && metadata.launcherFeatured !== "true" && metadata.launcherFeatured !== "false") {
    throw new Error(`${name}: launcherFeatured must be true or false`);
  }
  const slug = name.replace(/\.md$/u, "").replace(/^\d+\./u, "");
  return {
    id: metadata.launcherId,
    source: itemSource,
    channel,
    title: required(metadata, "title", name),
    summary: required(metadata, "description", name),
    publishedAt: `${required(metadata, "date", name)}T12:00:00Z`,
    featured: metadata.launcherFeatured === "true",
    url: metadata.launcherExternalUrl || `https://gwonmac.vercel.app/blog/${slug}`,
    ...(metadata.launcherStartsAt ? { startsAt: metadata.launcherStartsAt } : {}),
    ...(metadata.launcherEndsAt ? { endsAt: metadata.launcherEndsAt } : {}),
    body,
  };
}

const names = (await readdir(contentRoot)).filter((name) => name.endsWith(".md")).sort();
const stories = [];
for (const name of names) {
  const story = storyFrom(name, await readFile(path.join(contentRoot, name), "utf8"));
  if (story) stories.push(story);
}
const ids = new Set();
for (const story of stories) {
  if (ids.has(story.id)) throw new Error(`duplicate launcher news id: ${story.id}`);
  ids.add(story.id);
}
stories.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
const generated = `${JSON.stringify({ version: 1, stories }, null, 2)}\n`;
if (check) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) throw new Error("launcher news feed is stale; run pnpm --dir apps/website generate:launcher-news");
} else {
  await writeFile(outputPath, generated);
}
