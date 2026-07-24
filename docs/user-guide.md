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
**Graphics quality** changes rendering resolution; keep **1×** unless a sharper
image is worth the extra GPU work.
Settings shows the backing resolution for the current window beside every
scale. Compared with 1×, 1.5× renders 2.25 times as many pixels and 2× renders
four times as many pixels.
**Controls** owns right-drag pointer locking and the macOS Default, Guild Wars,
and Guild Wars 2 cursor choices, with an in-panel cursor preview. Guild Wars is
the default. Cursor size follows macOS display and accessibility settings.
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

## Report a problem

Choose **Help → Report a Problem…**.

- For a crash, startup, download, graphics, input, audio, or login problem,
  choose **Export Recent Diagnostics…**.
- For stutter, choose **Record Performance Problem**, reproduce it, press
  **Cmd+Shift+M** when it is visible, then use **View → Stop Capture**.

An always-visible capture indicator shows the recording type and elapsed time.
After **Cmd+Shift+M**, it confirms that the problem marker was registered.

The app creates one `.gwdiag` file and can open the project’s bug form or reveal
the file in Finder. The export is redacted and excludes credentials, account
identifiers, packet contents, request/response bodies, headers, cookies,
filesystem paths, and crash dumps. GitHub issues are public, so review the bug
form’s privacy notice before attaching it.

## Recovery behavior

- If startup cannot reach ArenaNet, the previous verified client is restored
  when available. Otherwise the launcher presents **Retry** as the primary
  recovery action.
- Pausing, closing, losing the network, or sleeping during a full download does
  not discard verified chunks. Choose **Resume Download** to continue.
- When there is not enough disk space, the download stops before fetching more
  data. Free space, then resume.
- Corrupt cached chunks are discarded and fetched again automatically.
- The first unexpected renderer crash is recovered automatically. If it
  repeats, use **View → Reload Game**, then **Help → Report a Problem…**.

## Updates and local data

The host app has no update-feed client. Replace it manually with a newer source
or release build. ArenaNet client files still update automatically.

Settings, cached chunks, client files, and bounded diagnostics live under the
normal macOS application-support directory, usually
`~/Library/Application Support/Guild Wars`.
