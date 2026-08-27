# AGENTS.md

Read this file before you change the repository. It defines how coding agents
must work in gwonmac.

Use [docs/README.md](docs/README.md) to find the document that owns a subsystem.
Read the owning document and the executable tests before you edit code.

## Goal

Produce the simplest correct system that the team can maintain.

Use this preference:

```text
delete > simplify > replace > add
```

Do not add a second path when one direct path can own the behavior. Prefer a
hard cutover. Delete the old path when the new path passes its tests.

Before you add an abstraction, table, cache, state, process, service, adapter,
registry, or compatibility path, answer these questions:

1. Can you delete something instead?
2. Can you simplify the existing owner?
3. Does a second real consumer exist?
4. Which requirement needs the new concept?
5. Which executable test proves that requirement?

## Agent-first operating model

Matthias coordinates the project. Agents execute repository work. Do not make
him reconstruct repository state or guess the next command.

For every task, an agent must:

1. Inspect the current branch, worktree, recent commits, and applicable CI.
2. Classify the task as normal development, release stabilization, or an
   emergency Stable patch.
3. Read the owning document and existing tests.
4. State any assumption that changes scope or release risk.
5. Implement the smallest complete outcome.
6. Run focused checks, then the applicable local repository gate.
7. Review the complete diff for unrelated changes and missing cleanup.
8. Report the outcome, evidence, remaining risk, and one clear next action.

Agents own investigation, implementation, automated verification, diff review,
pull-request preparation, and CI diagnosis. Matthias owns product priority,
live game QA, signing approval, publication approval, and release announcements.

An agent must not claim that gameplay, graphics, input feel, or another live
observation passed unless Matthias performed that check. Automation can report
only the boundary it executed.

See [Development and rollout](docs/development-workflow.md) for the complete
branch and release model.

## Sources of truth

Code and tests own exact schemas, values, hashes, limits, and accepted states.
Current documents own intent, boundaries, failure behavior, and procedures.
Files under `internal/` are historical evidence. They are not current
requirements.

When a document and executable behavior disagree, verify the behavior. Correct
the owning document in the same change.

Every module under `src/` must start with a block comment. State what the module
owns and why that owner exists. Do not describe implementation steps that the
code already shows.

## Project boundaries

gwonmac is an Electron host for ArenaNet's official Guild Wars WebAssembly
client. Electron is the only production runtime. The app ships no game
binaries.

Keep these boundaries:

- The main process owns native resources, files, network policy, credentials,
  windows, application updates, and client lifecycle.
- The preload transports a small validated capability surface. It does not own
  domain policy.
- The renderer owns presentation, browser composition, and game-host setup. It
  has no Node.js access.
- `src/shared/` owns values and contracts that two or more real consumers use.
- `ActiveClientSlot` owns the one published client generation.
- `ClientRuntime` owns preparation, activation, health, and recovery.
- `PatchClient` owns verified ArenaNet acquisition and staging.
- `AppUpdater` owns application-release discovery, download, and ready state.
- Settings workflows own confirmation and durable reset or relaunch actions.
  IPC validates and forwards them.

See [Process model](docs/process-model.md) for the full ownership map.

## Non-negotiable invariants

### Official client

- Keep ArenaNet's downloaded artifact canonical and unchanged.
- Create a separate derived artifact for a platform repair or optional Tools.
- Verify the exact derived output before use.
- Use the verified official artifact when optional certification refuses.
- Publish the client, compatibility facts, memory choice, and generation as one
  atomic active value.
- Publish `ready` only for that exact active generation.
- Do not replace client artifacts while a generation is active.

Runtime authority comes from compiled facts or the bounded isolated local
verifier. Do not add a remote certificate authority. See
[WASM host](docs/wasm-host.md).

### Optional Tools

- Keep the official game playable without optional Tools.
- Keep host-owned Build and Team authoring available when live integration is
  unavailable.
- Do not expose raw memory, packets, pointers, generic calls, or generic writes.
- Keep commands named, typed, bounded, confirmed, and region-gated.
- Disable observation and commands in unsupported or unknown regions.
- Team Apply is an explicit PvE-outpost configuration action. It is not
  autonomous gameplay.

### Processes and IPC

- Validate the sender and the value at every IPC boundary.
- Keep domain decisions behind the transport handler.
- Serve only exact allow-listed `gw://app` routes.
- Do not create an arbitrary filesystem or network bridge.
- Keep TCP handles, destination checks, backpressure, and cleanup in main.
- Close the application when the one game window closes.
- Await durable cleanup before quit or update installation.

### Network and secrets

- Keep game, web, update, and login destinations on closed allowlists.
- Drop browser cookies from the game web proxy in both directions.
- Do not store credentials in files, browser storage, logs, or diagnostics.
- Store provisioned saved login only in its fixed Data Protection Keychain
  item. Unprovisioned builds keep it only in memory.
- Do not add a fallback secret store.
- Keep the shared ArenaNet request ceiling. Demand work must outrank prefetch.
- Never load-test ArenaNet services.

### Updates

An **ArenaNet game update** changes the official client or game data. A
**gwonmac application update** changes this repository's packaged app. Do not
combine these systems.

Stable and Beta are preferences inside the Release identity. Alpha is not a
public update candidate. Preview is a separate tester identity and cannot use
the application updater. The app never performs an automatic downgrade.

Saving an update setting must not start an unrequested network call. The
explicit check is the immediate path. See
[Release verification](docs/release-verification.md).

### Diagnostics and privacy

Use one closed diagnostics schema and one local ZIP export. Do not add a
generic text logger.

Never record credentials, account identifiers, packet contents, bodies,
headers, cookies, crash dumps, or filesystem paths. Reject an unknown event
before writing it. Treat a pattern scan as a limited scan, not as proof.

Level 1 captures can measure performance. Level 2 traces can locate a cause,
but the profiler changes the result. See [Diagnostics](docs/diagnostics.md).

## Repository conduct

Preserve unrelated worktree changes. Do not commit downloaded client files,
game data, credentials, diagnostics, private traffic, generated packages, or
local Apple signing material.

Do not add third-party assets without a clear redistribution license. Preserve
all notices for ArenaNet material, QT Friz Quad, GWToolbox++, and
GuildWarsMapBrowser.

Use offline fixtures for automated tests. Run a live ArenaNet check only when a
local proof cannot establish the invariant. Keep the live check narrow and
record what it proves.

## Git and delivery

Use one topic branch for one pull-request outcome. Match the existing prefixes,
such as `feat/`, `fix/`, `refactor/`, `test/`, `docs/`, and `release/`.

Normal feature and maintenance branches start from `main` and target `main`.
Keep unfinished work on its branch. Do not merge incomplete code behind a
hidden flag.

Use `release/YYYY.M.PATCH` only for a planned release or emergency Stable patch.
A planned release branch starts from one selected green `main` commit. An
emergency release branch starts from the latest signed Stable tag. After the
branch exists:

- add no new feature;
- accept only version changes and release blockers;
- forward-port every release-only fix to `main`;
- also forward-port an emergency fix to any active planned release branch; and
- delete the release branch after publication and forward-porting.

Do not create permanent `develop`, `next`, `beta`, or `stable` branches. The
signed Stable tag is the production source. `main` can continue with completed
future work while a release branch stabilizes.

Use Conventional Commits. Keep commits atomic. Review staged changes before a
commit and the complete branch diff before a pull request.

Do not merge a pull request, delete a remote branch, create a tag, approve a
protected environment, publish a release, deploy update feeds, or announce a
release unless Matthias explicitly requests that action.

When an agent prepares a pull request, it must:

- update remote references;
- compare the complete branch against its intended base;
- confirm that the base matches the development or release path;
- remove unrelated changes;
- run the applicable verification;
- use a concise Conventional Commit title; and
- explain the outcome, invariant, tests, and rollout risk.

### Rollout choice

Do not publish a Beta for each feature. Use Developer Builds for individual
feature testing. Use one Beta train for a risky group of completed changes.

Require Beta consideration for persistence, migrations, accounts, Keychain,
updates, signing, packaging, client certification, native transforms, input,
controllers, rendering, reload, live observations, default-on behavior, or a
multi-feature release. A narrow emergency compatibility fix can go directly to
Stable after exact signed-draft QA.

Only Matthias can accept the exact draft and choose Beta or Stable. An agent
must present the risk and recommend one path.

## Verification

Run the narrowest relevant proof while you work. Then run the repository gate
before you finish.

```bash
pnpm run check
```

`pnpm run check` runs type checks, lint, Markdown links, unit tests, policy tests,
and Tools unit tests. It does not build or open a window.

GitHub **Application verification** owns the complete macOS gate for a pull
request. Wait for it, diagnose every failure, and require it to pass before
merge.

Run the complete gate locally when the change modifies CI, packaging, signing,
or release behavior, or when CI cannot provide the required evidence:

```bash
pnpm verify
```

Run `pnpm test:website` when you change `apps/website`. The website gate is
separate from the app gate.

Use signed, packaged, live-client, or release-only tests only for invariants
that the cheaper layer cannot prove. Do not turn a one-time migration story
into a permanent default test.

Before you finish, check:

- Did you create a second source of truth?
- Did you leave the old path behind?
- Did you add structure without a second consumer?
- Did you make failure or debugging harder?
- Did you change a trust boundary without an executable refusal test?
- Did you update the one document that owns the behavior?

## Documentation style

Use `gwonmac` as the project name. Use **Guild Wars Reforged for macOS** as the
short player-facing description.

Write editable technical prose with ASD-STE100 Issue 9 principles:

- Use one term for each concept.
- Use active voice.
- Keep most sentences below 25 words.
- Put one action in each numbered step.
- Start an instruction with a verb.
- Use **Do not** for a prohibition.
- Preserve exact code identifiers and user-interface labels.
- Separate an ArenaNet game update from a gwonmac application update.
- Link to the owner. Do not copy its rules.

Do not claim formal ASD-STE100 certification. Preserve standard legal text,
direct quotations, and raw investigation evidence when rewriting them would
change their meaning.

## Communication

Lead with the outcome. State assumptions and uncertainty. Connect every
recommendation to gwonmac evidence. Do not replace a clear technical reason
with a generic best practice.
