# macOS sequential-profile gate

Date: 2026-07-29

## Environment

- OS: macOS 26.5 (25F71), arm64
- Node.js: 24.18.0
- pnpm: 11.13.1
- Source: `00d4e8aee51b0bdb04e7080060be7415b1e7e11d`
- Network posture: offline fixtures; the live ArenaNet Electron smoke remained
  intentionally skipped

## Command

```bash
pnpm verify
```

## Result

Pass:

- typecheck, lint, and Markdown links;
- 567 unit tests;
- 20 integration tests;
- 58 Electron tests, with the one opt-in live client test skipped;
- 125 policy tests;
- 22 release-contract tests;
- packaged main, manager, profile launch, preload, renderer, diagnostics, and
  Enhancement runtime smoke;
- Forge package and make;
- final ZIP artifact inventory, hash, metadata, and fuse verification.

The final artifact checked by the gate was
`Guild Wars-darwin-arm64-2026.7.0-beta.1.zip`.

## Scope

This proves the automated macOS arm64 gate for the sequential profile
foundation. It does not prove:

- legacy IDBFS migration;
- Windows or Linux native behavior;
- real OS credential-provider matrices;
- physical input routing;
- live ArenaNet behavior;
- signing, notarization, SmartScreen, or native installer reputation;
- simultaneous Guild Wars clients.

Those items remain unchecked in the execution ledger.
