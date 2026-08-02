# Contributing

Thank you for improving Guild Wars Reforged for macOS. This is an independent
interoperability project: it hosts ArenaNet’s official client, ships no game
binaries, and shares ArenaNet’s production services with every other
installation. A change is judged on whether it keeps all three true.

This page is the way in for a person: what to read, how to run the project, and
what has to be green before you open a pull request. It links rather than
restating; each linked document owns its own subject.

## Bugs

In the app, choose **Help → Report a Problem…**. Attach the resulting single
`.gwdiag` file to the GitHub bug form. For a performance problem, start the
guided recording first and press **Cmd+Shift+M** when the problem is visible.

Do not attach credentials, packet captures, private account data, game
binaries, or crash dumps.

Report a security-sensitive finding privately instead — see
[`SECURITY.md`](SECURITY.md).

## Reading your way in

- [`docs/README.md`](docs/README.md) routes a technical question to the one
  document that answers it. Start there rather than searching the tree.
- [`AGENTS.md`](AGENTS.md) is the constraint list: the invariants that are
  load-bearing, what each part of `src/` owns, and how to verify a change. It
  also owns what a change is expected to look like — the
  `delete > simplify > replace > add` preference and what has to be named before
  anything is added, the comment every `src/` module opens with, what must never
  be committed, and the conduct ArenaNet’s shared services require. Read it
  before your first pull request. Where it disagrees with the code, the code is
  right and that file is a bug worth fixing in the same change.
- [`PRODUCT.md`](PRODUCT.md) records who this is for and what will not ship. A
  change that contradicts a non-goal is not one this project can take, however
  well it is built.
- [`docs/diagnostics.md`](docs/diagnostics.md#verification-boundaries) owns the
  claims table. A change that makes a new public claim — website, README, in-app
  copy — is not finished until it has a row there.

## Running it

Requirements, the first build, and the command table are in the
[README](README.md#development). The short version:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The first online run fetches the official client artifacts from ArenaNet; every
later run works from the local cache.

## Before you open the pull request

`pnpm check` is the fast no-build loop while you work; the
[Verification](AGENTS.md#verification) section says what it runs.

```bash
pnpm check
```

The complete local gate builds, packages, and launches a real application, so
run it once before opening the pull request:

```bash
pnpm verify
```

If you touch `apps/website`, run `pnpm test:website` too — it has its own CI
workflow and is not part of `pnpm verify`. The live test is opt-in because it
contacts ArenaNet:

```bash
pnpm build && GW_LIVE_SMOKE=1 pnpm test:electron
```

CI runs the same gate on every pull request and keeps the packaged app as an
artifact a reviewer can run. Say in the pull request what the change is for,
which invariant it protects, and what you ran to prove it.

Contributions are licensed under GPL-3.0-only.
