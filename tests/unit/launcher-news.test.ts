import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { LauncherNewsService, PROJECT_NEWS_URL, WIKI_UPDATES_URL, parseProjectNewsFeed } from "../../src/main/core/launcher-news.js";
import { DEFAULT_LAUNCHER_PREFERENCES } from "../../src/main/core/launcher-state.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function feed(channel: "stable" | "beta" = "stable") {
  return {
    version: 1,
    stories: [{
      id: `release-${channel}`,
      source: "launcher",
      channel,
      title: `${channel} release`,
      summary: "A useful player-facing summary.",
      publishedAt: "2026-09-01T12:00:00Z",
      featured: true,
      url: "https://gwonmac.vercel.app/blog/release",
      body: "Intro with **important text** and a [technical record](https://github.com/Mat4m0/gwonmac/releases/tag/v1).\n\n## Changes\n\n- First change\n\n![Screenshot](/blog/image.png)",
    }],
  };
}

const wiki = {
  query: { pages: { "1": {
    title: "Feedback:Game updates/20260901",
    fullurl: "https://wiki.guildwars.com/wiki/Feedback:Game_updates/20260901",
    extract: `
== Update - September 1, 2026 ==

=== Skill updates ===
 Mirage Cloak: Adjust additional block chance to 4..10 (so that Earth investment is required) and fixed a bug where damage from enchantment removal was getting improperly multiplied.
 Focused Shot: Removed errant cast time.

=== Guild Wars Wiki notes ===
Build: 38,888`,
  } } },
};

describe("launcher news", () => {
  it("rejects untrusted story links", () => {
    const input = feed();
    input.stories[0]!.url = "https://example.com/tracker";
    assert.throws(() => parseProjectNewsFeed(input), /not trusted/u);
  });

  it("filters Beta notes and projects Markdown into safe typed blocks", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwonmac-news-"));
    roots.push(root);
    const cachePath = join(root, "news.json");
    await writeFile(cachePath, JSON.stringify(feed("beta")));
    const service = new LauncherNewsService({ cachePath, fetch: async () => { throw new Error("offline"); }, openExternal: async () => undefined });
    await service.loadCache();
    assert.equal(service.snapshot("stable", DEFAULT_LAUNCHER_PREFERENCES).stories.length, 0);
    const beta = service.snapshot("beta", DEFAULT_LAUNCHER_PREFERENCES);
    assert.equal(beta.status, "offline");
    assert.deepEqual(beta.stories[0]?.body.map((block) => block.type), ["paragraph", "heading", "list", "image"]);
    assert.equal((beta.stories[0]?.body[0] as { content: readonly { emphasis?: string }[] }).content[1]?.emphasis, "strong");
  });

  it("combines the exact project and Wiki feeds, caches project notes, and opens only known IDs", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwonmac-news-"));
    roots.push(root);
    const cachePath = join(root, "news.json");
    const opened: string[] = [];
    const service = new LauncherNewsService({
      cachePath,
      fetch: async (url) => new Response(JSON.stringify(url === PROJECT_NEWS_URL ? feed() : url === WIKI_UPDATES_URL ? wiki : {})),
      openExternal: async (url) => { opened.push(url); },
      now: () => new Date("2026-09-02T10:00:00Z"),
    });
    await service.refresh();
    const snapshot = service.snapshot("stable", DEFAULT_LAUNCHER_PREFERENCES);
    assert.equal(snapshot.status, "ready");
    assert.deepEqual(snapshot.stories.map((story) => story.source), ["game", "launcher"]);
    assert.equal(
      snapshot.stories[0]?.summary,
      "Skill updates — Mirage Cloak: Adjust additional block chance to 4..10 (so that Earth investment is required) and fixed a bug where damage from enchantment removal was getting improperly multiplied.",
    );
    const article = snapshot.stories[1]!.body[0];
    if (article?.type !== "paragraph") throw new Error("expected the release introduction");
    const actionId = article.content.find((part) => part.actionId)?.actionId;
    assert.match(actionId ?? "", /^news-link-[a-f0-9]{8}$/u);
    await service.open("guild-wars-update-2026-09-01");
    await service.open(actionId!);
    assert.deepEqual(opened, ["https://wiki.guildwars.com/wiki/Feedback:Game_updates/20260901", "https://github.com/Mat4m0/gwonmac/releases/tag/v1"]);
    await assert.rejects(service.open("unknown-story"), /unavailable/u);
    assert.equal(parseProjectNewsFeed(JSON.parse(await readFile(cachePath, "utf8")) as unknown).length, 1);
  });
});
