# Contributing

## Read this first

We are not actively accepting broad contributions.

Small bug fixes, reliability fixes, and focused maintenance changes are
welcome. Contact us before you start a large change. Open an issue and describe
the problem, the proposed scope, and the proof you plan to add.

An issue does not guarantee that we will accept the change. This project keeps
a narrow scope because it hosts an online game client and shares ArenaNet's
services with other players.

## Changes we are likely to accept

- Small, focused bug fixes.
- Small reliability or security fixes.
- Measured performance improvements.
- Maintenance that removes code or reduces complexity.
- Documentation corrections that match executable behavior.

## Contact us before these changes

- New product features.
- User-interface redesigns.
- New dependencies or processes.
- New persistent or wire formats.
- Changes to client certification, networking, credentials, updates, or
  releases.
- Changes larger than one focused pull request.

Do not start a rewrite without agreement on the problem and scope.

## Report a bug

In the app, select **Help → Report a Problem…**. Attach the exported diagnostics
`.zip` file to the bug report if it is useful.

Do not attach credentials, packet captures, private account data, game
binaries, or crash dumps. Report a security issue through the private process
in [SECURITY.md](SECURITY.md).

## Set up the project

Read [AGENTS.md](AGENTS.md) before you change code. Use
[docs/README.md](docs/README.md) to find the document that owns your area.

```bash
xcode-select --install
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
```

Requirements are listed in the [README](README.md#build-from-source).

## Keep the pull request small

1. Change one behavior or one ownership boundary.
2. Explain the user or maintainer problem.
3. Name the invariant that the change protects.
4. Add the smallest executable proof.
5. Remove the old path in the same change.
6. Update the document that owns the changed behavior.

Do not mix cleanup, features, and unrelated fixes. For a user-interface change,
include clear before-and-after images. Include a short video when timing,
motion, or interaction is important.

## Verify the change

Start with the smallest relevant proof:

| Change | Fast proof |
| --- | --- |
| Pure main or renderer rule | Run the owning unit test file. |
| Process, window, or input behavior | Run the owning Electron test file. |
| Website behavior | Run `pnpm test:website`. |
| Markdown | Run `pnpm check:links`. |

Use `pnpm check` while you work:

```bash
pnpm check
```

Run the complete local gate before you open the pull request:

```bash
pnpm verify
```

If you changed `apps/website`, also run:

```bash
pnpm test:website
```

Do not run live ArenaNet tests unless the invariant requires them. Live tests
must be deliberate, bounded, and named in the pull request.

## Pull request description

State:

- what changed;
- why it is needed;
- what was deleted or simplified;
- which invariant proves the result; and
- which commands or manual checks passed.

Opening a pull request does not create an obligation to merge it. We may ask
you to reduce the scope, defer it, or close it.

Contributions are licensed under GPL-3.0-only.
