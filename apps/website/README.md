# Canopy API bilingual consumer

Workspace-owned English/German release-boundary fixture for the published
`@lupinum/ginko-content` and `@lupinum/ginko-docs` packages.

```bash
pnpm install --frozen-lockfile
pnpm test:website
```

The exact registry versions in `package.json` are intentional. Candidate
tarballs are certified by the upstream release repositories before publication;
this fixture verifies the packages users actually install from npm.

The consumer owns locale declarations, site identity and its mirrored content
trees. It does not override layer pages, layouts, navigation, SEO, search or
locale-switching components. The output assertion verifies translated roots,
localized LLM files, reciprocal hreflang alternates and strict locale sitemap
partitioning.
