# Contributing

Thank you for improving Guild Wars for macOS. This is an independent
interoperability project; keep changes narrow, maintainable, and respectful of
ArenaNet’s production services.

## Bugs

In the app, choose **Help → Report a Problem…**. Attach the resulting single
`.gwdiag` file to the GitHub bug form. For a performance problem, start the
guided recording first and press **Cmd+Shift+M** when the problem is visible.

Do not attach credentials, packet captures, private account data, game
binaries, or crash dumps.

## Changes

Before opening a pull request:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

The live test is opt-in because it contacts ArenaNet:

```bash
GW_LIVE_SMOKE=1 pnpm test:electron
```

Keep download concurrency at eight. Never commit downloaded game artifacts,
credentials, diagnostic exports, or private traffic. See
[`docs/internals.md`](docs/internals.md) for architecture and security
boundaries.

Contributions are licensed under GPL-3.0-only.
