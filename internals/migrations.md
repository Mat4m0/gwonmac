# Active migrations

## Split Travel preference storage

- Why: published Stable reads the district-bearing shortcut records in
  `settings.json`. Current Travel synonyms and recents need their own document
  that Stable does not parse or rewrite.
- Introduced: 2026-08-21, when Main became the one owner of both Travel
  preference files.
- Depends on it: numbered Travel shortcuts, synonyms, Recent history, and
  rollback to a supported Stable release.
- Remove when: the oldest Stable release that the project still supports for
  rollback owns the chosen single Travel document, and the signed
  Stable-to-candidate-to-the-same-Stable compatibility matrix passes with that
  storage shape. Migrate once, then remove the old field and this entry in the
  same change.

## Ginko consumer icon compatibility

- Why: Ginko Docs 0.2.3 gives Nuxt Icon a pruned Lucide collection before it
  discovers icons used by the consuming website. Those icons otherwise render
  without CSS.
- Introduced: 2026-08-21, with the website icon certification fix.
- Depends on it: the website's app and content-specific Lucide icons.
- Remove when: a Ginko Docs version at or above 0.2.5, together with its
  required Ginko Content version, passes the repository's strict website
  typecheck and certification. Remove the `modules:before` hook and the direct
  `@iconify-json/lucide` dependency with this entry.
