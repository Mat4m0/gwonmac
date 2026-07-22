# Guild Wars in your browser

Runs the WebAssembly build of Guild Wars locally, in an ordinary browser.

```bash
python3 gw.py
```

That is the whole thing. It downloads what it needs, serves it, and opens your
browser.

## Read this first — what actually works

This is a work in progress, and it matters to be straight about where it stops.

| | |
|---|---|
| ✅ The client downloads, boots and runs | |
| ✅ It reaches ArenaNet's live game servers | all twelve resolve and answer |
| ✅ Game data streams on demand, or downloads up front | |
| ❌ **You cannot log in** | nothing is wired up to take your credentials |
| ❓ Whether the game *draws anything* | untested on real hardware |

**You cannot currently play Guild Wars with this.** The client starts and talks
to ArenaNet, but the parts that would hand it a username and password
(`login`, `secureStorage`, `nativeAccount`) are stubs that only write to a log.
There is nothing to type credentials into. Authentication is the next piece of
work and it has not been started.

Rendering has only ever been exercised in a headless browser, where the game
aborts while compiling its shaders because there is no real GPU. On a normal
machine it may well draw fine — nobody has checked. If you try it, that is
genuinely useful information; see *If something goes wrong* below.

So this is worth running to see how far the port has got, or to work on it. It
is not yet a way to play the game.

## What you need

- **Python 3.8 or newer.** Nothing else — no `pip install`, no Node.js.
  - macOS and Linux already have it. Run `python3 --version` to check.
  - Windows: install from [python.org](https://www.python.org/downloads/) and
    tick **"Add python.exe to PATH"** during setup.
- **About 1 GB of free disk space**, or **5 GB** if you use `--image`.
- A recent **Chrome, Edge or Firefox**. Chrome is what this is tested against.

You do not need to own Guild Wars to get this far, because it never reaches a
login. You would need an account to actually play, once that exists.

## Running it

1. Download the latest **[release zip](https://github.com/gwdevhub/gw_in_browser/releases/latest)**.
2. **Unzip it properly**, to a real folder — do not run `gw.py` from inside the
   zip. Windows lets you open a zip like a folder, but double-clicking `gw.py`
   there runs it on its own without the rest of the game. (If you do, it will
   tell you so rather than failing silently.)
3. Start it:
   - **Windows**: double-click `gw.py`.
   - **macOS**: double-click `gw.command`. The first time, Finder may refuse
     with "cannot be opened because it is from an unidentified developer" --
     right-click it and choose **Open** instead, once.
   - **Linux**: open a terminal in the folder and run `python3 gw.py`.

Your browser opens by itself, and on Windows the black command window tucks
itself into the taskbar once it has. **Leave it running** — closing it stops
the server, and the game with it.

**Closing the browser stops it.** A few seconds after the last tab pointing at
the game is gone, `gw.py` shuts itself down — there is nothing left running and
nothing to remember to kill. Reloading the page, or having a second tab open,
does not trigger it.

You can also bring the window back up and press **Ctrl+C**, or just close it.

The window is deliberately minimised rather than hidden: it is where errors
appear, and it is the manual way to stop a server that is also holding a
network connection open.

### The first run takes a while

It downloads the game client first (about 8 MB), then the game starts pulling
its own data as it needs it — roughly 360 MB over a few minutes. The loading
screen shows both, with a speed and a time estimate.

Later runs are much quicker, because everything downloaded is kept.

### Downloading everything up front

To wait once instead of every time:

```bash
python3 gw.py --image
```

This fetches the complete 4.2 GB game image before starting — expect **around
20 minutes**. Afterwards the game needs no network at all for game data.

Stop it whenever you like with Ctrl+C and run it again later: it resumes exactly
where it left off and never re-downloads anything it already has.

## Options

You only need these to change a default or work around a problem.

| Option | What it does |
|---|---|
| `--image` | download all 4.2 GB before starting, instead of streaming |
| `-p 9000` | serve on a different port, if 8080 is taken |
| `--no-browser` | do not open a browser automatically |
| `--offline` | never download; use only what is already on disk |
| `--no-update` | skip the check for a newer game version |
| `--build asyncify` | the build for Safari and iOS (27.8 MB rather than 8.2 MB) |
| `-j 16` | download with more threads — see below |
| `-v` | log every request, for diagnosing a problem |

Run `python3 gw.py --help` for the full list.

### Downloading faster

Downloads are limited by round-trip time, not bandwidth, so more threads means
almost proportionally more speed:

| `-j` | speed | 4.2 GB takes |
|---|---|---|
| 8 (default) | ~3 MB/s | ~20 min |
| 16 | ~7 MB/s | ~9 min |
| 32 | ~12 MB/s | ~6 min |

```bash
python3 gw.py --image -j 16
```

**Please think before raising this much.** These are ArenaNet's real servers,
and everyone using this shares one access key — so if that key gets
rate-limited, patching breaks for actual paying players, not just for us. 8 is
the default for that reason, and 16 is already a favour being asked.

## Where it puts things

Everything lands next to `gw.py`. Nothing is installed system-wide and nothing
is written elsewhere:

- `dist/` — the game client and the page it is served from
- `gwpatch-cache/` — downloaded game data, kept in 256 KB pieces

Deleting either is safe; both are rebuilt on the next run. Deleting
`gwpatch-cache/` means downloading the game data again.

## If something goes wrong

**Double-clicking does nothing, or "python3: command not found"**
Python is missing or not on your PATH. See *What you need*. On Windows,
reinstall it with "Add python.exe to PATH" ticked.

**"Guild Wars cannot start: it is still inside the zip"**
Exactly what it says — extract the zip to a real folder first, then run `gw.py`
from there.

**"Address already in use"**
Something else has port 8080. Use `python3 gw.py -p 9000`.

**The page says it could not download the game**
Check your connection, then read the terminal window — the actual error is
printed there. Run it again; nothing already downloaded is lost.

**"Not enough disk space"**
`--image` needs about 5 GB free. Free some up, or run without `--image`.

**The loading screen finishes and the window is blank**
That is the open rendering question above. Please
[open an issue](https://github.com/gwdevhub/gw_in_browser/issues) saying which
operating system, browser and graphics card you have — that is exactly the
information this project is missing.

**It seems stuck**
Ctrl+C in the terminal and start it again. Progress is kept.

## For developers

The technical write-up — how the client is put together, the patch protocol,
the host interfaces the module expects, the WebSocket relay, snapshot read
performance and the tests — is in **[docs/internals.md](docs/internals.md)**.

`CLAUDE.md` records how the project got here and which mistakes not to repeat.

## Credits and legal

An independent fan project, **in no way affiliated with or endorsed by ArenaNet
or NCSoft**.

Guild Wars and all associated game content are © 2005–2026 ArenaNet, Inc. All
rights reserved. NCsoft, the interlocking NC logo, ArenaNet, Arena.net, Guild
Wars and all associated logos and designs are trademarks or registered
trademarks of NCsoft Corporation. All other trademarks are the property of
their respective owners.

Loading screen photography by
[Snapshot Henchman](https://bloogum.net/guildwars/).

This repository contains no game binaries. They are downloaded from ArenaNet's
own servers when you run it.

### Licence

GPL-3.0, matching `gwlauncher` and `gMod`. See `LICENSE`.

Copyleft is the deliberate choice here: the value of this repo is the recovered
knowledge of how the client is put together, and forks of it should stay open
for the same reason the original work was worth doing.

### Please be considerate

This talks to ArenaNet's real servers. Download concurrency is capped on
purpose, and the same access key is shared by everyone using this — so pushing
it harder risks getting that key rate-limited, which would break patching for
actual players. Please leave the limits where they are.
