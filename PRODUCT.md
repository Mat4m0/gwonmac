# PRODUCT.md

> **Stub.** This file exists so the documentation links resolve. It is filled in
> properly under P3.31 of the refactor program, which owns the product register:
> first Toolbox user, first feature, non-goals, and the claims we are willing to
> stand behind. One page. It must not become another architecture manual.

Until then, the honest summary:

- **What this is.** A sandboxed macOS Electron host for ArenaNet's official
  Guild Wars WebAssembly client. The host supplies platform services; it does
  not modify the game.
- **Who it is for.** People who want to run the official client on macOS
  without a browser tab, and — later — Toolbox users.
- **Non-goals.** No Windows or Linux build, no game modification, no account
  automation, no telemetry.

For current behaviour see [`README.md`](README.md), [`docs/user-guide.md`](docs/user-guide.md)
and [`docs/internals.md`](docs/internals.md).
