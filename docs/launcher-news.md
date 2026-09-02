# Launcher news and release notes

The website Markdown files are the one source of truth for GWonMac release notes and curated event stories. The website renders the full article and generates the launcher's small static feed at `apps/website/public/launcher/news-v1.json`.

## Publish a GWonMac release note

Create a post in `apps/website/content/en/2.blog`. Keep the first paragraph and `description` useful to a player. Technical verification details belong in the GitHub release, not in the launcher summary.

Add these flat frontmatter fields:

```yaml
launcherId: gwonmac-2026-9-0
launcherSource: launcher
launcherChannel: stable
launcherFeatured: true
```

Use `launcherChannel: beta` for a Beta-only release. Stable users never receive Beta entries. Beta users receive Stable and Beta entries.

Markdown supports paragraphs, `##` headings, bullet lists, bold text, inline code, links, and images. Images must be stored under `apps/website/public` and referenced with a website-relative path. The launcher renders this safe subset as native Vue elements; it never injects HTML.

## Publish an important event

Use the same blog workflow with:

```yaml
launcherId: guild-wars-pirate-week-2026
launcherSource: event
launcherChannel: all
launcherFeatured: true
launcherExternalUrl: https://wiki.guildwars.com/wiki/Pirate_Week
launcherStartsAt: 2026-09-13T19:00:00Z
launcherEndsAt: 2026-09-20T19:00:00Z
```

Curate only events that help players plan. The launcher fetches ordinary game update notes directly from the Guild Wars Wiki, so do not copy those into the website.

## Validate before publishing

Run:

```sh
pnpm --dir apps/website generate:launcher-news
pnpm --dir apps/website check
```

Commit the Markdown and regenerated JSON together. The check fails for duplicate IDs, unsupported fields, invalid channels, or a stale generated feed.

## Runtime behavior

- Electron main fetches only the exact GWonMac feed and Guild Wars Wiki API URLs.
- Responses and images have byte limits and strict origin/type checks.
- The last valid GWonMac feed is cached for offline use.
- The renderer receives typed content and opaque story IDs, never arbitrary navigation or fetch access.
- Source visibility and automatic rotation are presentation preferences stored in `launcher-state.json`.
