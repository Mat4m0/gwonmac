# Residual review findings — `feat/steam-login-unified`

Accepted, not fixed. From the code review of the Steam login work (8 reviewers:
correctness, security, reliability, project-standards, testing, maintainability,
api-contract, plus an independent cross-model adversarial pass through `codex`
— independence verified, served model/effort unverified on that route).

Everything else the review found was fixed in `090a744`. These three are
recorded rather than fixed, with the reasoning, so the decision is visible
rather than lost.

## 1. A server-side-revoked token can only be recovered by signing out

**P1, correctness, confidence 50, `src/main/core/steam-session.ts`**

`resolveSteamToken` returns a stored, unexpired token before it consults
`silent`, so even the explicit button click replays it. Nothing in the system
learns that `login.xml` refused the credential — the resolution layer has no
failure signal at all. A player whose token is revoked server-side
(deauthorising the app in Steam, a password change, ArenaNet unlinking) keeps
replaying a dead token until its local expiry, up to a year.

**Why not fixed.** There *is* a recovery path and `docs/user-guide.md` documents
it: signing out in the game clears the local token, after which the Steam button
acquires a new one. So this is a rough edge, not a dead end — the reviewer's
"no in-app recovery" reads stronger than the code warrants.

The proposed fix (treat a second explicit click as evidence the first credential
was refused, then clear and re-acquire) is a product decision about what a
second click means, not a defect repair. The plan also defers the underlying
question: **Q4, "Does ArenaNet expose a revocation surface"** is explicitly
follow-up work.

**If revisited:** the clean fix is a real failure signal, not a heuristic — the
client would need to tell the host that `login.xml` refused the credential.
Whether any such seam exists is Q4's question.

## 2. The non-silent path is never driven end-to-end through IPC

**P1, testing, confidence 50** (`src/main/ipc.ts`)

Every piece is covered — `resolveSteamToken`'s branches against a fake acquire
in `tests/unit/steam-session.test.ts`, and the real window against a local
fixture server in `tests/electron/steam-acquire.spec.ts` — but the seam that
joins them is not. No test proves `{ silent: false }` from the renderer actually
reaches `acquire()`, or that `{ silent: true }` never does, through the real
bridge and the real IPC channel. A regression in those few lines of `ipc.ts`
would ship with the whole suite green.

**Why not fixed.** The offline suite must never reach `steamcommunity.com`, and
`src/main/ipc.ts` imports `acquireSteamToken` directly with no injection point.
Closing it needs either `require.cache` patching (fragile, and the ESM import is
already bound by the time a test could intervene) or a test-only injection seam
on `registerIpcHandlers` — production code carrying a branch that exists only for
tests. Neither is obviously better than the current split, which is honest about
what it covers.

**Currently covered by:** the injected-config fixture spec for the window
mechanics, the unit tests for the resolution branches, and the one sanctioned
live confirmation.

**If revisited:** an injection seam on `registerIpcHandlers` (defaulting to the
real `acquireSteamToken`) is the smaller change of the two, and would let the
existing fixture config drive the whole seam offline.

## 3. Subframe navigation inside the sign-in window is unguarded

**P1, cross-model adversarial, confidence 75** (`src/main/steam-acquire.ts`)

`will-navigate` and `will-redirect` are main-frame events, so an iframe on an
allowlisted Steam page can navigate to any origin. `AGENTS.md`'s "navigation
confined to a fail-closed allowlist" is therefore narrower than it reads.

**Why not fixed — deliberately, and this one is a judgment call worth stating.**
Two reasons:

1. **No token path follows.** The peer also claimed a child-frame redirect could
   reach the OAuth finish path. It cannot: because those two events are
   main-frame-only, the redirect handler never sees a subframe navigation, so a
   subframe cannot deliver a state-matching response. The token exists only in
   the intercepted top-level fragment.
2. **The fix would plausibly break live sign-in.** Guarding subframes with
   `will-frame-navigate` against the same allowlist would block any third-party
   frame Steam's own login page loads — a captcha from a non-Valve origin being
   the obvious case. Tightening what the window *allows* on the strength of an
   offline fixture, right before the first live confirmation, trades a real
   regression risk for a hardening with no demonstrated attack path.

The safer half of the peer's suggestion — requiring the main frame before
accepting a redirect — is already true by construction.

**If revisited:** do it after a live sign-in has shown which origins the real
Steam page actually needs, then allowlist those and guard the rest.

## 4. R18's visible origin is not satisfied, and is accepted as unsatisfied

**P2, security, confidence 50, `src/main/steam-acquire.ts`** — confirmed by live
test, resolved as accepted.

R18 asks that the sign-in window "displays the live origin in a region the loaded
page cannot draw over or rename". `showOrigin()` writes the origin into the window
title and `page-title-updated` is `preventDefault`ed so the page cannot change it
— but the window ships as a modal child, macOS presents that as a sheet, and a
sheet draws no title bar. **Confirmed by live test: the origin is not visible.**

**Why it is not fixed.** The obvious fix — drop `modal` so the window gets its own
title bar — was tried and is worse. `src/main/window.ts` restores the game window
to fullscreen, so a plain parented child is promoted into that fullscreen space
and sized to the whole display: the Steam page filled the screen, and after
sign-in the screen went black (that blank full-screen window sitting through the
awaited partition clear). `modal` is therefore load-bearing for usability, and
`tests/electron/steam-acquire.spec.ts` now pins it.

The remaining options all cost more than the requirement is worth here: a custom
origin strip owned by main and drawn above the web view, or `titleBarStyle`
experiments that may not survive the sheet presentation at all. The owner accepted
the gap explicitly rather than spend that.

**What actually constrains the window,** and what the docs now say instead of
asking the player to check a title bar: navigation is confined to a fail-closed
allowlist of Steam- and Valve-owned origins, the window carries no preload and no
Node, it runs in a throwaway partition destroyed with it, and the redirect is
read by the application rather than followed. The protection is that the window
cannot go anywhere else — not that the player verifies where it is.

`showOrigin()` and the rename guard are kept rather than deleted, because a
parentless window (no game window yet) is an ordinary titled window where both do
apply.

**Documented in:** `docs/user-guide.md` (states plainly that there is no origin
to check, and what to rely on instead), `docs/internals.md` (the reasoning and
the modal trade-off), `AGENTS.md` (do not write docs or UI telling a player to
verify the origin).

## Smaller residual risks (noted, no action)

- A freshly acquired token is stored with the flow's hardcoded ~1-year lifetime
  rather than the `expires_in` the authorize response returns, so a
  shorter-lived token can sit at rest and be replayed until that year is up. The
  failure mode is a refused login, not a compromise.
- The `state` nonce travels in the authorize URL's query string, so a script
  same-origin with the Steam login page can read it. Inherent to the implicit
  flow: `state` defends against unsolicited and replayed responses, not against
  a compromised identity provider.
- `session.fromPartition` mints a uniquely named session per attempt and Electron
  caches partition sessions for the process lifetime, so attempts accumulate
  `Session` objects. Bounded by sign-ins per launch; storage and cache are
  explicitly cleared on every settle path.
- `token !== stored.token` in `refreshSteamExpiry` is not a constant-time
  comparison. Only reachable by a caller that already holds the token.
- `isRedirectTarget` requires a byte-exact pathname, and `www.guildwars.com` is
  deliberately absent from the origin allowlist. If the live flow ever returns to
  a near-miss path (`/app/live/auth/`), the navigation is blocked rather than
  recognised, and a successful Steam sign-in would present as a cancellation.
  Fail-closed and diagnosable — `signInBlocked: navigation` then
  `signInResult: cancelled` — but the flow's least-verified edge, since the
  authorize request's wire shape could not be read out of Auth Connect's
  compiled native code.
- The `EncryptedJsonStore.load()` path where `readFile` fails for a non-ENOENT
  reason (permissions, I/O) is rethrown untested. Unchanged behaviour carried
  over from the pre-refactor credential store.
