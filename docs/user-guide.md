# Guild Wars for macOS user guide

Guild Wars for macOS is an independent host for ArenaNet’s official Guild Wars client. It is not affiliated with ArenaNet or NCSoft and does not
bundle game binaries.

## Install and start

Current builds are ad-hoc signed and not notarized. The project deliberately
does not require a paid Apple Developer subscription.

To build from source:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm package
```

Open `out/Guild Wars-darwin-arm64/Guild Wars.app`. On the first launch macOS may
block an ad-hoc build. Try to open the app once, then open **System Settings →
Privacy & Security**, scroll to **Security**, click **Open Anyway**, and confirm
the second prompt. Do not disable Gatekeeper globally.

Published releases include SHA-256 checksums, an SPDX SBOM, and GitHub
build/SBOM attestations. Follow [Verify a release](release-verification.md)
before opening a downloaded build.

The app then:

1. checks the official game client;
2. prepares the files needed to start;
3. starts Guild Wars;
4. downloads additional areas only when the game asks for them.

The first start needs an internet connection and takes longer than later
starts. The ArenaNet client updater and game-data cache always use at most eight
concurrent ArenaNet requests.

## Quick Start and the full game

Quick Start is the default. It keeps the loading screen tied to data the game
actually needs and caches downloaded areas for later.

On the first online start, the loading screen offers **Quick Start
(Recommended)** or **Download Full Game**. Guild Wars, its audio, networking,
and graphics do not start before this decision.

Quick Start starts Guild Wars and downloads areas when needed. Download Full
Game remains in the launcher, shows verified bytes, speed, and ETA, and does
not start Guild Wars automatically. When complete, choose **Play Guild Wars**.
While downloading you may pause, return to Quick Start, or explicitly choose
**Play Now Instead**; only that last action starts the game early and lets the
full download continue in the background.

The displayed transfer rate is a short moving average, so chunk-completion
bursts do not make the number jump between unrealistic highs and lows. While a
full download is active, progress also appears on the application’s Dock icon.
macOS may turn the display off, but the app prevents download suspension until
the task finishes or is paused.

To schedule the complete game from a running session:

1. Open **Guild Wars → Settings…**.
2. Select **Full Game** under **Game data mode**.

The current session is not interrupted. The next launch opens the resumable
full-download launcher when data is still missing. Choose **Start Downloading
Now** only when you want the same task to run in the background during the
current session. Switching back to Quick Start stops speculative full download
work but keeps every verified chunk.

The full download is optional. It requires enough free disk space for all
missing chunks plus a safety margin. It improves offline area availability,
but login and online play still require ArenaNet’s services.

Use **Clear Game Data…** only when you want to remove downloaded game data.
The app confirms the action and restarts. Small client files stay installed.

## Settings

Settings save immediately. **Game Data** owns the canonical Quick Start/Full
Game strategy, optional current-session download, and cache controls.
**Graphics quality** changes rendering resolution. **Retina — 2×** is the
visual-quality default; choose 1.5× or 1× when higher frame rate or lower GPU
memory use matters more than sharpness.
Settings shows the backing resolution for the current window beside every
scale. Compared with 1×, 1.5× renders 2.25 times as many pixels and 2× renders
four times as many pixels.
Right-drag always locks the pointer while steering the camera and restores it
on release. **Controls** owns two independent GWonMac Tools choices. **Use the
game's own cursor** is on by default: the host reads the cursor Guild Wars itself draws
out of your installed client and shows it over the game view; no cursor artwork
ships with this app and none is downloaded. **Show target distance and range**
is off by default and adds the selected target's distance and range band at the
top of the game view. Either choice can be changed without enabling the other.
Changing either one changes which observations the launch prepares, so the app
has to restart to apply it: it asks first, and if you cancel, nothing is saved
and the boxes return to what they were. **Reset Launcher Settings…** restores
the cursor to on and the target readout to off.
**Reload Game** reuses the module the launch already chose.
When the cursor is off — and whenever it cannot be read, or
your client build is not one this host has certified — you get the normal macOS
pointer. That is a cosmetic difference only: nothing about how the game plays
changes with the box either way. The rest of the window always keeps the macOS
pointer.
Touch compatibility and the local performance overlay stay under
**Advanced**, outside the normal setup path. Settings reopens to the pane most
recently used during the current session.

The official WebAssembly client currently requests a WebGL context without
multisampling, so its in-game antialiasing list may contain only **None**. The
host does not display options the client cannot provide; the 1.5× and 2×
render scales are the available supersampling choices.

The official client contains browser Gamepad support and community reports
confirm that controllers work. Physical controller behavior is not part of
the automated release gate because the project has no dedicated test
controller yet.

Settings are always available with **Command-,**, **Guild Wars → Settings…**,
or the **Settings** link on the loading screen. **Reset Launcher Settings…**
under **Advanced** restores launcher defaults, resets the window to a centered
1280×800 normal window, and makes the download choice appear on the next
launch. It does not remove downloaded game data, the remembered account name,
or the saved password.

The application remembers its last normal size and position plus maximized or
fullscreen mode. If a saved monitor is disconnected, the window is clamped and
centered on the primary display instead of opening off-screen. Choose **View →
Reset Window Size and Position** for an immediate window-only reset.

Guild Wars' **Remember Password** checkbox controls saved login. The password
is encrypted in an owner-only local file and is not placed in macOS Keychain,
so the application does not show a Keychain prompt. Because unsigned builds
use Chromium's local mock encryption provider, this is weaker than Keychain:
software running as your macOS user may be able to recover it. Leave
**Remember Password** off if that tradeoff is not acceptable. Browser cookies
are cleared at startup and quit.

## Signing in with Steam

If you bought Guild Wars on Steam you have no ArenaNet email or password, so the
login screen also offers **Sign in with Steam** beside the email and password
fields. Use whichever matches how you bought the game; adding Steam takes
nothing away from the email and password route.

Choosing Steam opens a separate Steam sign-in window that this application owns.
macOS presents it as a sheet attached to the game window, and a sheet draws no
title bar, so **there is no address bar or origin label for you to check** — you
cannot verify by eye that the page is Steam's.

What protects you instead is that the sheet's top-level page may only navigate
to Steam- and Valve-owned addresses; a top-level navigation anywhere else is
blocked outright. Like an ordinary browser, Steam may embed resources or frames
from other providers. They remain inside Chromium's sandbox with no Node,
preload, application permissions, popups, or downloads, and cannot complete the
top-level sign-in redirect. The window runs in a throwaway browser session of
its own with no access to the game or to this application, and the sign-in
result is read by the application itself rather than by loading whatever page
the redirect points at. If the sheet ever renders empty or broken, close it and
use the email and password fields instead of typing your Steam password into it.

Once you finish signing in, the window closes by itself and the game continues to
character select. Everything that window stored while it was open, cookies
included, is destroyed with it.

You only do this once per machine. The sign-in is remembered in an encrypted,
owner-only local file and replayed on later launches, so no Steam window appears
again until it expires or you sign out. It carries the same tradeoff as the saved
password above: it is not in macOS Keychain, and on an unsigned build software
running as your macOS user may be able to recover it. If the file cannot be read,
or the sign-in has expired or been revoked, you are simply returned to the login
screen — the application does not fail to start.

Signing out in the game forgets the local copy. It does not unlink your accounts.

**This signs you in to a Steam account that is already linked to a Guild Wars
account — it cannot create that link.** If Steam authenticates you but the
account service reports that no Guild Wars account matches, the login is
refused and you are returned to the login screen. Linking is managed by
ArenaNet, not here: see the Guild Wars support site at
<https://help.guildwars.com/> for how Steam and Guild Wars accounts are
connected.

## Report a problem

Open the project’s bug form on GitHub, or choose **Help → Report a Problem…**
in the app to export diagnostics and open it. Diagnostics are optional.

- For a crash, startup, download, graphics, input, audio, or login problem,
  choose **Export Recent Diagnostics…**.
- For stutter, choose **Record Performance Problem**, reproduce it, press
  **Cmd+Shift+M** when it is visible, then use **View → Stop Capture**.
- When investigating a repeatable long loading stall with a Chromium trace,
  start the trace and wait five seconds before entering the portal or changing
  maps. Stop the capture after the destination has rendered. The initial wait
  keeps CPU-profiler startup outside the transition being investigated.

An always-visible capture indicator shows the recording type and elapsed time.
After **Cmd+Shift+M**, it confirms that the problem marker was registered.

The app creates one `.gwdiag` file and can reveal it in Finder. GitHub does not
accept that extension directly: Control-click the file, choose **Compress**,
and attach the resulting `.zip`.

Your password, saved login, account name, game traffic, and crash dumps are
never recorded, so they are not in the export to begin with. The event log the
report is built from is a closed list: each event carries numbers, flags, and
short codes, so a failure is recorded as a code rather than as its text, and
an export that cannot account for one of its own events fails instead of being
written. Everything else in the file — Chromium's trace, the graphics and
environment report, your launcher settings — is scanned for passwords, tokens,
email addresses, and file paths, and those are replaced. That scan recognizes
known patterns, so treat it as strong rather than absolute. The export is an
ordinary ZIP you can open and read before attaching it. GitHub issues are
public, so review the bug form’s privacy notice as well.

## Recovery behavior

- If startup cannot reach ArenaNet, the previous verified client is restored
  when available. Otherwise the launcher presents **Retry** as the primary
  recovery action.
- Pausing, closing, losing the network, or sleeping during a full download does
  not discard verified chunks. Choose **Resume Download** to continue.
- When there is not enough disk space, the download stops before fetching more
  data. Free space, then resume.
- Corrupt cached chunks are discarded and fetched again automatically.
- If Guild Wars saved files cannot be opened, choose **Reset Saved Files…**.
  After confirmation, this removes local game preferences, build templates,
  screenshots, and chat logs, then restarts. Downloaded game data and the
  saved login stay untouched.
- The first unexpected renderer crash is recovered automatically. If it
  repeats, use **View → Reload Game**, then **Help → Report a Problem…**.

## Updates

Updating this app is manual. Download a newer release, replace
`Guild Wars.app`, and your settings, saved login, and downloaded game data stay
where they are. The app never downloads or installs anything by itself.
ArenaNet's own client files still update automatically; that is the game
updating, not the app.

The app does not poll for releases. It asks GitHub whether a newer version
exists only when one of three things happens:

1. You choose **Check for Updates**, on the loading screen or under
   **Settings → Advanced**.
2. You choose **Check for Updates** on the notice that appears when the app
   does not recognize the game client build ArenaNet is currently serving.
3. The app starts while **Check for app updates automatically** is on. That
   box is off unless you turn it on; the first-launch screen offers it beside
   the download-mode question, and **Settings → Advanced** owns it afterwards.
   It performs one check per launch, and nothing else checks in the background.

While the box is off, the app contacts GitHub only when you press **Check for
Updates** yourself — including on a client build it does not recognize.

A check has three possible answers, and "we could not tell" is never reported
as good news:

- a newer version exists, with a link to the releases page;
- you are on the latest version;
- the check could not be completed, and the message says why — GitHub could not
  be reached, did not answer within five seconds, refused further requests from
  your network, returned an error or an unreadable answer, or this build's
  version is not on the release line.

**Last checked** beside the button records when the last release-check attempt
finished and survives a restart, so a failed check cannot be mistaken for a
fresh success.
Repeated presses reuse every answer for ten minutes, including an offline,
timeout, server, rate-limit, or unreadable response, instead of sending more
requests. After that bounded pause, pressing the button asks GitHub again.

## When the client build is not certified

Each ArenaNet client build is certified separately for two things: the repair
that makes build templates, screenshots, and chat logs work, and the read-only
enhancement transform used by the cursor and target readout. When ArenaNet ships
a build this app has not certified — or has certified for saving files but not
yet for the GWonMac Tools you selected — the loading screen says so once for
that build, names exactly what is affected, and offers **Play Guild Wars** as
the primary action. The notice explains; it does not block you.

Gameplay is unaffected either way: no stat, no timing, and no input path
changes. Recovery needs a new release of this app; retrying, reinstalling, or
clearing downloaded game data cannot certify a build. The same status is always
visible under **Settings → Controls**. An uncertified client build does not mean
the app is out of date — whether a newer release exists is the separate question
above, which the notice's own **Check for Updates** button answers.

The two GWonMac Tools choices control their observations independently. The cursor
choice reads only the cursor Guild Wars is drawing. The target-readout choice
reads map, player, and selected-target state and shows a small line at the top
of the game view; it disappears with no target, cannot be clicked, and never
covers anything interactive. A disabled tool performs no per-tick collection.
With both choices off, no enhancement hook is installed, no companion kernel loads,
and nothing observes game memory. Either way nothing the app does sends game
input or acts on your behalf. On a certified build the app derives one narrowly
patched module that connects the client's missing file operations to its
sandboxed persistent filesystem, which
is what makes build templates, screenshots, and chat logs work; the downloaded
official artifact is unchanged whichever way the box is set.

## Local data

Settings, cached chunks, client files, and bounded diagnostics live under the
normal macOS application-support directory, usually
`~/Library/Application Support/Guild Wars`.
