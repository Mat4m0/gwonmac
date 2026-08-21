# Active migrations

## Unhead 3.x family pin

- Why: a fresh Nuxt dependency resolution can mix Unhead 2.x and 3.x APIs,
  which breaks the website build and server before a page can render.
- Introduced: 2026-08-04 in commit `b93839ff`.
- Depends on it: the Nuxt website build, server bundle, and generated head
  metadata.
- Remove when: delete both `unhead` overrides, regenerate the lockfile with
  `pnpm install --lockfile-only`, then a clean `pnpm install --frozen-lockfile`
  and `pnpm test:website` both pass without a mixed Unhead family.

## Ginko sidebar padding override

- Why: Ginko Docs 0.2.3 always gives the sidebar scroll viewport `pt-2`, even
  when this site's group navigation renders no section switcher above it.
- Introduced: 2026-08-02 in commit `b929e496`.
- Depends on it: the top spacing of grouped desktop documentation navigation.
- Remove when: with the CSS rule deleted, `pnpm test:website` passes and
  `/docs/guides/install` at a 1280 x 900 viewport retains 32 px between the
  sidebar scroll viewport and its first navigation row without consumer CSS.

## Website package metadata repairs

- Why: `@nuxt/scripts` 0.13.4 imports `estree-walker`, and `nuxt-define`
  1.0.0 imports `@nuxt/kit`, but neither published manifest declares that
  runtime dependency. Nuxt I18n 10.6.0 also asks Nuxt Kit to resolve its
  declared Intlify runtime from outside the I18n package, which requires a
  narrow public hoist under pnpm's isolated linker.
- Introduced: 2026-08-21 with dependency isolation restoration.
- Depends on it: fresh website preparation and certification without wildcard
  package hoisting.
- Remove when: the pinned packages declare or resolve these imports themselves;
  delete both `packageExtensions` and the six-entry `publicHoistPattern`, regenerate
  the lockfile, and require a clean `pnpm install --frozen-lockfile` plus
  `pnpm test:website` and `pnpm package:built` to pass.

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
