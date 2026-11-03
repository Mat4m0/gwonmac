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
- Guild Wars Wiki cards show the first player-facing update item with its section name. Page headings, Wiki maintenance notes, and build metadata stay out of the preview.
- Responses and images have byte limits and strict origin/type checks.
- The last valid GWonMac feed is cached for offline use.
- The renderer receives typed content and opaque story IDs, never arbitrary navigation or fetch access.
- Source visibility and automatic rotation are presentation preferences stored in `launcher-state.json`.

## Release notes and the Guide inside the app

The launcher bundles two parts of the website at build time, so they work offline and match the installed version:

- **What's new.** The release post whose `launcherId` is `gwonmac-<version with dashes>` is bundled with that version. After an update, the launcher opens it once as an article in **News**. Write the next release's post with `draft: true` in its frontmatter: the website and the news feed leave a draft out, but the app build includes it. Remove `draft: true` when you publish the release.
- **Guide.** The pages listed in `PAGE_PATHS` (`apps/launcher/src/guide.ts`) become **Help**: the feature pages in `apps/website/content/en/1.docs/4.features`, plus Build templates, Performance, Troubleshooting, and Known issues from `1.guides`. `7.known-issues.md` is also the Known issues list. Install and mobile linking stay on the website.
- **Links.** `settings:<section>/<control>` opens that setting in the launcher and shows as bold text on the website; the IDs come from `src/shared/settings-catalogue.ts`. `$docs/features/<page>` and `$docs/guides/<page>` open the Guide page when the Guide has it, otherwise the website.
- **Media.** Images must be under `apps/website/public/docs` (Guide) or `apps/website/public/blog` (release notes). A screenshot or video that is still to be made is written as a placeholder, shown as a dashed box in both places:

  ```md
  ::media-placeholder{type="video"}
  Switch Character from an outpost. 10 s.
  ::
  ```

`apps/launcher/src/guide.test.ts` fails when a Guide link or image does not resolve. Game updates in News come from the wiki page source of the five newest `Feedback:Game updates/` pages and are shown in full.
