# Active migrations

## Apply-Team rollback projection

- Why: the supported rollback Stable still reads `teamManagement`, so the
  candidate temporarily writes that derived alias beside canonical
  `buildLibrary`. The parser also retains a permanent read alias for dormant
  profiles that may keep the released legacy shape indefinitely.
- Introduced: 2026-08-26 with the hard Core/Tools launch boundary follow-up.
- Depends on it: the supported rollback Stable that reads and writes
  `teamManagement` instead of `buildLibrary`.
- Remove when: that Stable is outside the supported rollback window and the
  signed Stable/Beta gate accepts settings without `teamManagement`. Remove
  only the serializer projection, its rollback tests, and this entry. Keep the
  parser fallback and parser test for dormant profiles; `AppSettings` must
  remain free of `teamManagement`.

## Skill-label enablement inference

- Why: releases before the individual Tools refactor treated any configured
  skill-key label as the feature opt-in. Those profiles have bindings but no
  `skillKeyLabelsEnabled` field, so the reader infers `true` once instead of
  silently hiding an existing overlay.
- Introduced: 2026-08-26 with the individual Tools settings refactor.
- Depends on it: players who configured a skill-key label before the separate
  feature switch existed and have not saved settings with the new release.
- Remove when: the oldest supported profile and rollback release both write
  `skillKeyLabelsEnabled`. Remove the missing-field inference, its parser test,
  and this entry together.

## Retired game-data strategy field

- Why: Stable v2026.8.9 expects `settings.json` to contain `dataStrategy` and
  restores its first-run chooser when the key is absent. The runtime now has
  one automatic complete-game download path, so the field serializes only as
  the rollback-safe value `full` and controls no current behavior.
- Introduced: 2026-08-23 with the automatic complete-game download cutover.
- Depends on it: rollback from a newer release to v2026.8.9 without asking the
  player to choose a retired download mode again.
- Remove when: v2026.8.9 is outside the supported rollback window and the
  signed Stable-to-candidate-to-the-same-Stable compatibility matrix permits a
  settings document without `dataStrategy`. Remove the contract field, parser
  normalization, serializer output, tests, and this entry together.

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

## Travel v1 rollback placeholders

- Why: Stable v2026.8.9 requires `travel-preferences.json` to contain the exact
  four-field v1 shape. The withdrawn Recent fields therefore serialize only as
  disabled, empty placeholders; the runtime model contains only synonyms.
- Introduced: 2026-08-22 when Recent destinations were withdrawn.
- Depends on it: rollback from a newer release to v2026.8.9 without losing
  Travel search phrases.
- Remove when: v2026.8.9 is outside the supported rollback window and the signed
  Stable-to-candidate-to-the-same-Stable compatibility matrix passes with a
  synonyms-only document. Remove the storage-codec placeholders and this entry
  in the same change.

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
