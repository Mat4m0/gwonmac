# Active migrations

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
