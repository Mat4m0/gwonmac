#!/usr/bin/env python3
"""Run Guild Wars in your browser. Double-click this file, or:

    python3 gw.py

It downloads what it needs on first run, serves it, and opens a browser.
Nothing to install -- Python 3.8+ and its standard library are enough.

Keep the harness/, images/ and fonts/ directories next to this file.

What it replaces: this is bootstrap.py, run.py and relay.js in one process.
The relay sharing the file server's port is what makes that worth doing --
same origin, so no CORS, no port to agree on, and no second process to reap.
"""

import argparse
import base64
import hashlib
import http.client
import json
import mimetypes
import os
import re
import select
import shutil
import socket
import struct
import sys
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ArenaNet's client key, lifted from the public app bundle. It identifies the
# client to the patch CDN; it does not authenticate a user. Hardcoded so this
# file works on its own -- see gwkey.py to extract one yourself if it rotates.
ACCESS_KEY = "2043FE79-F32D-4FD7-8C27-0D47231C4F03"

PATCH_ROOT = "https://patching.1.arenanetworks.com"
UA = "gwpatch/0.2 (interop research)"
SNAPSHOT = "Gw.snapshot"

# instantiateStreaming is strict about this and older Pythons do not know it.
mimetypes.add_type("application/wasm", ".wasm")

# Two builds of the same game. JSPI suspends via engine stack switching;
# Asyncify instruments every function that might be on the stack instead,
# which is why Gw.wasm is 27.8 MB against Gw.jspi.wasm's 8.2 MB.
# The launcher picks with:  ios ? Asyncify : 'Suspending' in WebAssembly
BUILDS = {
    "jspi": ["Gw.jspi.js", "Gw.jspi.wasm"],
    "asyncify": ["Gw.js", "Gw.wasm"],
}
COMMON = ["version.json"]

# Prefetch concurrency. Single-stream is latency-bound at ~0.4 MB/s because
# each 256 KB chunk costs ~650ms, and throughput scales nearly linearly with
# workers (16 -> 7.5 MB/s, 32 -> 12 MB/s). It is capped here anyway: this is
# ArenaNet's production CDN and ACCESS_KEY is shared by every install, so a
# per-user burst is really every install at once. See "Conduct" in CLAUDE.md.
PREFETCH_JOBS = 8

VERBOSE = False   # -v; routine request logging is off by default

_HASHES = {32: "md5", 40: "sha1", 64: "sha256"}
_FATAL = (401, 403, 404)  # retrying these cannot help

# Only the screenshot credit -- the copyright and trademark notice is static
# markup in index.html, so it cannot vanish when a fetch fails.
ART_CREDIT = ('Screenshots by <a href="https://bloogum.net/guildwars/">'
              'Snapshot Henchman</a>')


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def _getch():
    """Block until a key is pressed, without needing Enter where possible."""
    try:
        import msvcrt                     # Windows
        msvcrt.getch()
        return
    except ImportError:
        pass
    try:
        import termios, tty
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            # TCSANOW, not tty.setraw's default TCSAFLUSH: flushing discards a
            # key pressed a moment too early, and then nothing closes the
            # window -- which is the exact failure this function exists to fix.
            tty.setraw(fd, termios.TCSANOW)
            # os.read, not sys.stdin.read: the latter goes through a buffered
            # text wrapper that keeps blocking after the keypress.
            os.read(fd, 1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
    except Exception:
        try:
            input()                       # no raw mode; Enter will have to do
        except Exception:
            pass


def die(*lines):
    """Explain the problem, then wait so the message can actually be read.

    A double-clicked console window closes the instant the process exits, so
    printing an error and returning shows the user nothing at all -- the window
    just blinks. Waiting is skipped when nobody is watching: under CI, a pipe
    or a redirect there is no one to press a key and blocking would hang.
    """
    sys.stderr.write("\n" + "\n".join(lines) + "\n")
    if sys.stdin.isatty() and sys.stderr.isatty():
        sys.stderr.write("\nPress any key to close...")
        sys.stderr.flush()
        _getch()
        sys.stderr.write("\n")
    sys.exit(1)


# What has to sit next to gw.py. images/ and fonts/ are deliberately not here:
# without them the loading screen falls back to a gradient and a stock
# typeface, which is a worse-looking game rather than a broken one.
REQUIRED = [
    "harness/index.html",
    "harness/harness.js",
    "harness/harness.css",
    "harness/loading.js",
    "harness/loading.css",
]


def check_install(here):
    """Refuse to start, legibly, when this copy cannot work."""
    if sys.version_info < (3, 8):
        die("Guild Wars needs Python 3.8 or newer.",
            "",
            "This is Python %d.%d, at %s."
            % (sys.version_info[0], sys.version_info[1], sys.executable),
            "",
            "Install a current version from https://www.python.org/downloads/",
            "and, on Windows, tick \"Add python.exe to PATH\" during setup.")

    missing = [f for f in REQUIRED if not (here / f).exists()]
    if not missing:
        return

    # Windows opens a zip like a folder and, on double-click, extracts only the
    # file you clicked into a temp directory whose path still contains the
    # zip's name. gw.py then starts completely alone, which is much the most
    # likely way for anyone to end up here.
    if ".zip" in str(here).lower():
        die("Guild Wars cannot start: it is still inside the zip.",
            "",
            "Double-clicking gw.py inside a zip runs only that one file,",
            "without the rest of the game beside it.",
            "",
            "Extract the whole zip to a real folder first -- right-click it",
            "and choose \"Extract All\" -- then run gw.py from there.")

    die(*(["Guild Wars cannot start: some of its files are missing.",
           "",
           "Looked in: %s" % here,
           "",
           "Missing:"]
          + ["  " + f for f in missing]
          + ["",
             "gw.py needs its harness folder beside it. Download the project",
             "again and keep the folder together rather than moving gw.py out",
             "on its own."]))


def _human(n):
    return "%.2f GB" % (n / 1e9) if n >= 1e9 else "%.0f MB" % (n / 1e6)


def minimise_console():
    """Tuck our own console away once the browser has it, on Windows.

    Only when we own the console -- GetConsoleProcessList returns just this
    process when the file was double-clicked, and more when it was launched
    from an existing shell. Minimising someone's own terminal would be rude.

    Minimised rather than hidden: this window is how you stop the server, and
    a local file server plus a TCP relay left running with no visible way to
    stop it is worse than a taskbar button.
    """
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes
        k32, u32 = ctypes.windll.kernel32, ctypes.windll.user32
        hwnd = k32.GetConsoleWindow()
        if not hwnd:
            return                      # pythonw, or no console at all
        buf = (ctypes.c_uint * 4)()
        if k32.GetConsoleProcessList(buf, 4) != 1:
            return                      # a shell is sharing it; leave it alone
        u32.ShowWindow(hwnd, 6)         # SW_MINIMIZE
    except Exception:
        pass                            # never worth failing a launch over


class Watchdog:
    """Exit when the last browser tab has gone.

    The page pings while it is open and sends a goodbye beacon as it closes,
    so the ordinary case -- user closes the tab -- shuts the server down within
    GRACE seconds and leaves nothing running.

    GRACE exists because `pagehide` also fires on a reload and on navigation.
    Quitting the instant a beacon arrives would kill the server during an F5;
    any ping from the reloaded page cancels the countdown instead. It also
    covers a second tab still being open: its next ping arrives well inside the
    window and keeps us alive.

    IDLE is the backstop for a browser that died without saying goodbye. It is
    deliberately far longer than GRACE because browsers throttle timers in
    hidden tabs -- Chrome drops background tabs to about one tick a minute, so
    anything under that would quit while the user was merely alt-tabbed.

    Tabs are tracked by id rather than by a single "last seen" clock, because a
    plain ping can arrive *after* the goodbye from the same tab: the interval
    fires a beacon just as the page hides, and sendBeacon guarantees no
    ordering. That stray reset the countdown and the server never exited. Timing
    cannot tell it from a reload's first ping -- both land milliseconds later --
    so identity does it instead: once a tab has said goodbye its later pings are
    ignored, while a reload arrives under a fresh id and keeps us alive.
    """

    GRACE = 3.0
    IDLE = 150.0
    FORGET = 30.0   # how long a departed tab's id is remembered

    def __init__(self, httpd):
        self.httpd = httpd
        self.lock = threading.Lock()
        self.live = {}        # tab id -> last seen
        self.gone = {}        # tab id -> when it said goodbye
        self.seen = False     # has anything ever connected
        self.empty_since = None

    def ping(self, tab, leaving=False):
        now = time.time()
        with self.lock:
            self.seen = True
            if leaving:
                self.gone[tab] = now
                self.live.pop(tab, None)
            elif tab not in self.gone:
                self.live[tab] = now
            for t, when in list(self.gone.items()):
                if now - when > self.FORGET:
                    del self.gone[t]

    def run(self):
        reason = None
        while reason is None:
            time.sleep(0.5)
            now = time.time()
            with self.lock:
                if not self.seen:
                    continue          # nothing has connected yet; wait
                for t, when in list(self.live.items()):
                    if now - when > self.IDLE:
                        del self.live[t]   # tab died without saying goodbye
                if self.live:
                    self.empty_since = None
                    continue
                if self.empty_since is None:
                    self.empty_since = now
                elif now - self.empty_since >= self.GRACE:
                    reason = "browser closed"
        log("%s -- stopping" % reason)
        self.httpd.shutdown()


def _duration(seconds):
    seconds = int(seconds)
    if seconds < 90:
        return "%ds" % seconds
    if seconds < 5400:
        return "%d min" % round(seconds / 60)
    return "%.1f hours" % (seconds / 3600)


# ---- HTTPS client ---------------------------------------------------------
# urllib opens a fresh connection per request. For many small chunks the
# TCP + TLS handshake dominates the transfer, so keep one connection per
# thread and reuse it.

class Http:
    def __init__(self, headers=None):
        self.headers = headers or {}
        self._local = threading.local()

    def _conn(self, scheme, host, fresh=False):
        conns = getattr(self._local, "conns", None)
        if conns is None:
            conns = self._local.conns = {}
        key = (scheme, host)
        if fresh and key in conns:
            conns.pop(key).close()
        if key not in conns:
            cls = (http.client.HTTPSConnection if scheme == "https"
                   else http.client.HTTPConnection)
            conns[key] = cls(host, timeout=60)
        return conns[key]

    def request(self, method, url, body=None, headers=None, tries=4, raise_4xx=True):
        """Absolute URL in, (status, headers, body) out. Retries with backoff
        on anything that is not a settled refusal -- this is someone else's
        production CDN, so back off rather than hammer."""
        from urllib.parse import urlsplit
        u = urlsplit(url)
        path = u.path + ("?" + u.query if u.query else "")
        hdrs = {**self.headers, **(headers or {})}
        for attempt in range(tries):
            # A pooled connection may have been closed by the far end since we
            # last used it; that surfaces as an exception on the first write,
            # so a retry has to start from a new socket rather than reuse it.
            conn = self._conn(u.scheme, u.netloc, fresh=attempt > 0)
            try:
                conn.request(method, path, body=body, headers=hdrs)
                r = conn.getresponse()
                data = r.read()
                # The proxy passes upstream failures through untouched -- a 401
                # from the login service is a real answer, not a transport fault.
                if raise_4xx and r.status >= 400:
                    raise HttpError(r.status, url)
                return r.status, r.headers, data
            except HttpError as e:
                if e.status in _FATAL or attempt == tries - 1:
                    raise
                time.sleep(2 ** attempt)
            except (OSError, http.client.HTTPException):
                self._conn(u.scheme, u.netloc, fresh=True)
                if attempt == tries - 1:
                    raise
                time.sleep(2 ** attempt)

    def get(self, url, tries=4):
        return self.request("GET", url, tries=tries)[2]


class HttpError(Exception):
    def __init__(self, status, what):
        super().__init__("HTTP %d for %s" % (status, what))
        self.status = status


def patch_http():
    return Http({"X-Access-Key": ACCESS_KEY, "User-Agent": UA,
                 "Accept-Encoding": "identity", "Connection": "keep-alive"})


# ---- patch manifest -------------------------------------------------------

class Manifest:
    def __init__(self, raw):
        if raw.get("compressionMode") not in ("none", "gzip"):
            raise ValueError("unsupported compression: %r" % raw.get("compressionMode"))
        self.compression = raw["compressionMode"]
        self.chunk_size = raw["chunkSize"]
        if not isinstance(self.chunk_size, int) or self.chunk_size <= 0:
            raise ValueError("bad chunkSize: %r" % self.chunk_size)

        # directories[] and files[] are flat lists linked by parentIndex;
        # a falsy parentIndex means the root, mirroring the client's own check.
        dirs = raw.get("directories") or []
        paths = []
        for d in dirs:
            parts, cur = [d["name"]], d.get("parentIndex")
            while cur:
                parts.append(dirs[cur]["name"])
                cur = dirs[cur].get("parentIndex")
            paths.append("/".join(reversed(parts)))

        self.files = {}
        for f in raw.get("files") or []:
            p = f.get("parentIndex")
            path = "%s/%s" % (paths[p], f["name"]) if p else f["name"]
            expected = (f["size"] + self.chunk_size - 1) // self.chunk_size
            if len(f["chunkHashes"]) != expected:
                raise ValueError("chunk count mismatch for %s" % path)
            self.files[path] = f

    def find(self, basename):
        return next((p for p in self.files if p.split("/")[-1] == basename), None)


def store_chunk(cache, h, data):
    """Write atomically. Assembly trusts anything present in the cache, so a
    half-written entry from an interrupted run would be baked into the output
    silently. Rename is atomic within a filesystem: absent, or complete."""
    tmp = cache / ("%s.%d.tmp" % (h, os.getpid()))
    tmp.write_bytes(data)
    os.replace(tmp, cache / h)


def fetch_chunk(http_, cache, h, compression="none"):
    data = http_.get("%s/%s.bin" % (PATCH_ROOT, h))
    if compression == "gzip":
        import gzip
        data = gzip.decompress(data)
    algo = _HASHES.get(len(h))
    if algo and hashlib.new(algo, data).hexdigest() != h.lower():
        raise ValueError("hash mismatch on chunk %s" % h)
    cache.mkdir(parents=True, exist_ok=True)
    store_chunk(cache, h, data)
    return data


class Progress:
    """What the loading screen is told, served at /progress.json.

    Every field is read by loading.js; `total` of 0 means "no meaningful
    total", which the bar renders as an indeterminate sweep rather than a
    made-up percentage.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._s = {"phase": "starting", "label": "Starting…",
                   "received": 0, "total": 0, "done": False, "error": None,
                   "prefetch": None, "note": ""}

    def set(self, **kw):
        with self._lock:
            self._s.update(kw)

    def snapshot(self):
        with self._lock:
            return dict(self._s)


def publish(src, out):
    """Copy a source directory into the served tree, returning what is in it.

    The sources are the truth: without re-copying, an edit to harness/ or
    images/ silently does nothing, which looks exactly like a change that had
    no effect. Unchanged files are left alone so mtimes stay stable.
    """
    out.mkdir(parents=True, exist_ok=True)
    names = []
    for f in sorted(src.iterdir()) if src.is_dir() else []:
        if not f.is_file() or f.name == "index.json":
            continue
        served = out / f.name
        if not served.exists() or served.read_bytes() != f.read_bytes():
            served.write_bytes(f.read_bytes())
        names.append(f.name)
    return names


def copy_art(src, dest):
    """Publish images/ and index it. The index is generated rather than
    committed, so dropping another background into images/ is all it takes."""
    out = dest / "images"
    names = publish(src, out)
    (out / "index.json").write_text(json.dumps({
        "logo": "images/logo.webp" if "logo.webp" in names else None,
        "backgrounds": ["images/" + n for n in names if n.startswith("bg")],
        "credit": ART_CREDIT,
    }))


def update(dest, cache, build, jobs=4, progress=None):
    """Fetch any client file that is missing or the wrong size, and write the
    snapshot's chunk index so the server can serve it without assembling it."""
    http_ = patch_http()
    log("checking for updates ...")
    mf = Manifest(json.loads(http_.get(PATCH_ROOT + "/manifest.json")))

    dest.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    builds = list(BUILDS) if build == "both" else [build]
    wanted = []
    for name in [f for b in builds for f in BUILDS[b]] + COMMON:
        path = mf.find(name)
        if not path:
            log("  ! %s is not in the manifest, skipping" % name)
            continue
        entry = mf.files[path]
        out = dest / name
        if not (out.exists() and out.stat().st_size == entry["size"]):
            wanted.append((name, entry, out))

    # Size the whole job before starting any of it: a bar that resets to zero
    # at each file is worse than no bar. The final chunk of a file is short,
    # so take its size from the file rather than assuming chunkSize.
    def chunk_bytes(entry, i):
        return min(mf.chunk_size, entry["size"] - i * mf.chunk_size)

    todo = [(h, chunk_bytes(e, i)) for _, e, _ in wanted
            for i, h in enumerate(e["chunkHashes"]) if not (cache / h).exists()]
    total = sum(n for _, n in todo)
    if progress and total:
        progress.set(phase="client", label="Downloading Guild Wars…",
                     received=0, total=total)

    got = [0]
    got_lock = threading.Lock()

    for name, entry, out in wanted:
        hashes = entry["chunkHashes"]
        missing = sorted({h for h in hashes if not (cache / h).exists()})
        log("  %s: %.1f MB, %d chunks (%d to fetch)"
            % (name, entry["size"] / 1e6, len(hashes), len(missing)))
        if missing:
            sizes = {h: chunk_bytes(entry, i) for i, h in enumerate(hashes)}
            def grab(h):
                fetch_chunk(http_, cache, h, mf.compression)
                with got_lock:
                    got[0] += sizes[h]
                    n = got[0]
                if progress:
                    progress.set(received=n)
                if total:
                    print("\r    %d%%" % (100 * n // total), end="", flush=True)
            with ThreadPoolExecutor(max_workers=jobs) as pool:
                list(pool.map(grab, missing))
            print()

        if progress:
            progress.set(label="Assembling %s…" % name)
        tmp = out.with_suffix(out.suffix + ".part")
        with open(tmp, "wb") as fh:
            for h in hashes:
                fh.write((cache / h).read_bytes())
        os.replace(tmp, out)
        log("  %s: ready" % name)

    # The snapshot is 4.2 GB and is never assembled; record its chunk layout so
    # ranges can be answered straight from the cache.
    path = mf.find(SNAPSHOT)
    if path:
        entry = mf.files[path]
        (dest / "snapshot-chunks.json").write_text(json.dumps({
            "size": entry["size"], "chunkSize": mf.chunk_size,
            "cache": str(cache), "chunkHashes": entry["chunkHashes"],
        }))
    log("up to date")


class ChunkStore:
    """Random access over a file that exists only as cached chunks.

    A chunk that is not cached is fetched on demand and kept, so this converges
    on exactly the working set boot touches -- about 30 chunks, ~7.5 MB of the
    4.2 GB -- rather than the whole file. The real client does the same.
    """

    def __init__(self, index_path, http_=None):
        idx = json.loads(Path(index_path).read_text())
        self.size = idx["size"]
        self.chunk_size = idx["chunkSize"]
        self.hashes = idx["chunkHashes"]
        self.cache = Path(idx["cache"])
        self.http = http_
        self.fetched = 0
        self._locks = {}
        self._guard = threading.Lock()
        # Which chunks a boot actually touches. Recorded so the next run can
        # fetch them up front in parallel instead of discovering them one
        # 650ms round trip at a time. ~1400 chunks, about 360 MB.
        self.touched = set()
        self._touched_dirty = False
        self.quiet = False   # bulk runs report progress themselves

    def _ensure(self, i):
        h = self.hashes[i]
        path = self.cache / h
        if path.exists():
            return path
        if not self.http:
            raise FileNotFoundError("chunk %d (%s) not cached, and offline" % (i, h))
        # Per-hash lock so concurrent reads of one chunk fetch once, without
        # serialising reads of different chunks.
        with self._guard:
            lock = self._locks.setdefault(h, threading.Lock())
        with lock:
            if path.exists():  # another thread won the race
                return path
            fetch_chunk(self.http, self.cache, h)
            self.fetched += 1
            # Per-chunk during a bulk run is 9500 lines that read as if work
            # were being repeated: the indices start mid-file, because earlier
            # chunks are already cached, and run backwards, because workers
            # finish out of order. Bulk callers report their own progress.
            if not self.quiet:
                log("  snapshot: fetched chunk %d (%d this session)" % (i, self.fetched))
        return path

    @property
    def boot_list(self):
        return self.cache / "boot-chunks.json"

    def save_touched(self):
        """Persist the working set. Merged with whatever is already recorded,
        because a boot that aborts early would otherwise shrink the list."""
        if not self._touched_dirty:
            return
        known = set()
        try:
            known = set(json.loads(self.boot_list.read_text())["chunks"])
        except Exception:
            pass
        merged = sorted(known | self.touched)
        if merged != sorted(known):
            tmp = self.boot_list.with_suffix(".tmp")
            tmp.write_text(json.dumps({"chunkSize": self.chunk_size,
                                       "count": len(self.hashes),
                                       "chunks": merged}))
            os.replace(tmp, self.boot_list)
        self._touched_dirty = False

    def prefetch(self, progress, jobs=PREFETCH_JOBS):
        """Warm the recorded working set in the background.

        Concurrency is capped deliberately. Single-stream is latency-bound at
        ~0.4 MB/s because each chunk costs ~650ms, and it scales nearly
        linearly with workers -- but this is ArenaNet's production CDN and the
        access key is shared by every install, so 8 is the agreed ceiling.
        See "Conduct" in CLAUDE.md before raising it.
        """
        if not self.http:
            return
        try:
            want = json.loads(self.boot_list.read_text())["chunks"]
        except Exception:
            return  # nothing recorded yet; this run is the one doing the recording
        todo = [i for i in want if i < len(self.hashes)
                and not (self.cache / self.hashes[i]).exists()]
        if not todo:
            return

        total = len(todo)
        done = [0]
        log("prefetch: warming %d chunks (%.0f MB) with %d workers"
            % (total, total * self.chunk_size / 1e6, jobs))
        progress.set(prefetch={"done": 0, "total": total})

        def grab(i):
            try:
                self._ensure(i)
            except Exception:
                pass  # the game will ask for it itself; a miss here is not fatal
            done[0] += 1
            if done[0] % 8 == 0 or done[0] == total:
                progress.set(prefetch={"done": done[0], "total": total})

        self.quiet = True
        try:
            with ThreadPoolExecutor(max_workers=jobs) as pool:
                list(pool.map(grab, todo))
        finally:
            self.quiet = False
        log("prefetch: done")
        progress.set(prefetch={"done": total, "total": total})

    def download_all(self, progress, jobs, stop):
        """Fetch every chunk of the image, for --image.

        Reports bytes rather than chunk counts because the loading screen
        renders a byte total, and because the final chunk is short. Resumable
        for free: the cache is content-addressed, so an interrupted run picks
        up where it stopped and a later game update refetches only what changed.
        """
        todo = [i for i, h in enumerate(self.hashes)
                if not (self.cache / h).exists()]
        total = self.size
        have = len(self.hashes) - len(todo)
        got = [have * self.chunk_size]

        if not todo:
            log("image: already complete (%d chunks)" % len(self.hashes))
            return True

        need = sum(min(self.chunk_size, self.size - i * self.chunk_size)
                   for i in todo)
        free = shutil.disk_usage(self.cache).free
        log("image: %d of %d chunks missing (%s), %s free"
            % (len(todo), len(self.hashes), _human(need), _human(free)))
        # Refuse rather than fill the disk and fail 3 GB in. The margin leaves
        # the rest of the system somewhere to write while this runs.
        if free < need + 512 * 1024 * 1024:
            progress.set(phase="error",
                         error="Not enough disk space: %s needed, %s free."
                               % (_human(need), _human(free)))
            return False

        progress.set(phase="image", label="Downloading game data…",
                     received=got[0], total=total, done=False)
        started = time.time()
        lock = threading.Lock()
        failed = []
        self.quiet = True
        last = [started]

        def grab(i):
            if stop.is_set():
                return
            size = min(self.chunk_size, self.size - i * self.chunk_size)
            try:
                self._ensure(i)
            except Exception as e:
                # One bad chunk must not abandon a 4 GB download: the game can
                # still fetch it on demand, and a rerun retries it.
                failed.append((i, str(e)))
                return
            with lock:
                got[0] += size
                n, elapsed = got[0], time.time() - started
            rate = (n - have * self.chunk_size) / elapsed if elapsed > 0.5 else 0
            eta = _duration((total - n) / rate) if rate > 0 else ""
            progress.set(received=min(n, total), total=total,
                         note="%.1f MB/s · %s remaining" % (rate / 1e6, eta) if rate else "")
            # One line every 10s, in terms a person can act on: how much is
            # left, not which chunk index a worker happened to finish.
            with lock:
                due = time.time() - last[0] >= 10
                if due:
                    last[0] = time.time()
            if due:
                log("image: %s of %s (%.0f%%) · %.1f MB/s · %s remaining"
                    % (_human(n), _human(total), 100.0 * n / total, rate / 1e6, eta))

        try:
            with ThreadPoolExecutor(max_workers=jobs) as pool:
                list(pool.map(grab, todo))
        finally:
            self.quiet = False

        if stop.is_set():
            return False
        if failed:
            log("image: %d chunks failed, e.g. %s" % (len(failed), failed[0][1]))
            progress.set(phase="error",
                         error="%d chunks could not be downloaded. Restart to retry."
                               % len(failed))
            return False
        log("image: complete in %s" % _duration(time.time() - started))
        progress.set(note="")
        return True

    def read(self, start, length):
        out = bytearray()
        pos, remaining = start, length
        while remaining > 0:
            i = pos // self.chunk_size
            if i >= len(self.hashes):
                break
            if i not in self.touched:
                self.touched.add(i)
                self._touched_dirty = True
            data = self._ensure(i).read_bytes()
            off = pos - i * self.chunk_size
            take = min(remaining, len(data) - off)
            out += data[off:off + take]
            pos += take
            remaining -= take
        return bytes(out)


# ---- DNS ------------------------------------------------------------------

ALLOWED_DOMAINS = [d.strip().lower() for d in os.environ.get(
    "GW_RELAY_DOMAINS", "arenanetworks.com,guildwars.com").split(",") if d.strip()]
FALLBACK_DNS = ["1.1.1.1", "8.8.8.8"]


def allowed_name(host):
    h = host.lower().rstrip(".")
    return any(h == d or h.endswith("." + d) for d in ALLOWED_DOMAINS)


def _dns_query(name, server, timeout=3):
    """Minimal A-record query. Python has no stdlib resolver beyond
    getaddrinfo, and getaddrinfo is exactly what we need to bypass."""
    qid = struct.unpack("!H", os.urandom(2))[0]
    q = struct.pack("!HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    for label in name.rstrip(".").split("."):
        q += bytes([len(label)]) + label.encode()
    q += b"\0" + struct.pack("!HH", 1, 1)

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout)
        s.sendto(q, (server, 53))
        data, _ = s.recvfrom(2048)

    if len(data) < 12 or struct.unpack("!H", data[:2])[0] != qid:
        raise OSError("bad DNS reply")
    rcode = struct.unpack("!H", data[2:4])[0] & 0xF
    if rcode:
        raise OSError("DNS rcode %d" % rcode)
    qd, an = struct.unpack("!HH", data[4:8])

    off = 12
    def skip_name(off):
        while off < len(data):
            n = data[off]
            if n == 0:
                return off + 1
            if n & 0xC0 == 0xC0:  # compression pointer, always terminal
                return off + 2
            off += n + 1
        raise OSError("truncated DNS name")

    for _ in range(qd):
        off = skip_name(off) + 4
    for _ in range(an):
        off = skip_name(off)
        rtype, _, _, rdlen = struct.unpack("!HHIH", data[off:off + 10])
        off += 10
        if rtype == 1 and rdlen == 4:
            return ".".join(str(b) for b in data[off:off + 4])
        off += rdlen
    raise OSError("no A record")


def lookup(name):
    """Three tiers, because each fails in a way the next survives.

    getaddrinfo honours /etc/hosts, nsswitch and any VPN split-horizon, so it
    is the right answer when it works -- but it also validates addresses.
    geodc.arenanetworks.com resolves to 0.0.1.2, an A record carrying a
    datacenter id rather than an address, and Windows rejects 0.0.0.0/8 with
    WSAHOST_NOT_FOUND. Raw queries do no such validation.
    """
    tried = []
    try:
        return socket.getaddrinfo(name, None, socket.AF_INET)[0][4][0], "getaddrinfo"
    except OSError as e:
        tried.append("getaddrinfo:%s" % e)

    for server in _system_resolvers() + FALLBACK_DNS:
        try:
            return _dns_query(name, server), "dns %s (%s)" % (server, ", ".join(tried))
        except OSError as e:
            tried.append("%s:%s" % (server, e))
    raise OSError("; ".join(tried))


def _system_resolvers():
    try:
        text = Path("/etc/resolv.conf").read_text()
    except OSError:
        return []
    return [m.group(1) for m in re.finditer(r"^nameserver\s+([0-9.]+)", text, re.M)]


# ---- the relay's address rules --------------------------------------------
# A WebSocket-to-TCP bridge on localhost is an open proxy: every page in the
# browser can reach it, not just ours. Without limits, any site you visit could
# use it to reach hosts on your LAN it could never reach directly. So:
#
#   * bind 127.0.0.1 only, never a routable interface
#   * /dns resolves names under ALLOWED_DOMAINS and nothing else
#   * dial only public unicast addresses -- loopback, LAN and link-local out
#   * destination ports allowlisted
#   * the Origin header must be this server
#
# The address test rather than "only IPs we resolved" is deliberate: the client
# gets its game server address from the authenticated login response, not from
# DNS, so no lookup passes through /dns and the tighter rule would block
# everything legitimate. What that rule really guarded was reaching hosts a
# page could not reach itself -- a property of the address, so test the address.

ALLOWED_PORTS = {int(p) for p in os.environ.get(
    "GW_RELAY_PORTS", "6112,80,443").replace(" ", "").split(",") if p}
CONNECT_TIMEOUT = 10

# Test-only escape hatch: e2e.js needs to dial a fixture on loopback, which is
# precisely what the address rule exists to forbid. Off unless asked for, and
# it announces itself, because a quiet way to disable this would be worse than
# not having the rule at all.
ALLOW_PRIVATE = os.environ.get("GW_RELAY_ALLOW_PRIVATE") == "1"


def is_public_ipv4(ip):
    p = ip.split(".")
    if len(p) != 4:
        return False
    try:
        a, b, c, d = (int(x) for x in p)
    except ValueError:
        return False
    if not all(0 <= n <= 255 for n in (a, b, c, d)):
        return False
    if a == 0: return False                          # 0.0.0.0/8, and the geodc sentinel
    if a == 10: return False                         # RFC1918
    if a == 127: return False                        # loopback
    if a == 169 and b == 254: return False           # link-local, incl. cloud metadata
    if a == 172 and 16 <= b <= 31: return False      # RFC1918
    if a == 192 and b == 168: return False           # RFC1918
    if a == 100 and 64 <= b <= 127: return False     # CGNAT
    if a == 192 and b == 0: return False             # IETF protocol assignments
    if a >= 224: return False                        # multicast and reserved
    return True


def is_public_ip(ip):
    if ":" not in ip:
        return is_public_ipv4(ip)
    h = ip.lower()
    if h in ("::1", "::"):
        return False
    if re.match(r"^f[cd]", h): return False          # unique local
    if re.match(r"^fe[89ab]", h): return False       # link-local
    m = re.search(r"(\d+\.\d+\.\d+\.\d+)$", h)       # ::ffff:a.b.c.d
    return is_public_ipv4(m.group(1)) if m else True


# ---- RFC 6455 framing -----------------------------------------------------
# Only what a binary relay needs: unmasked server frames out, masked client
# frames in, no fragmentation on the write side.

WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def frame(payload, opcode=0x2):
    n = len(payload)
    if n < 126:
        head = bytes([0x80 | opcode, n])
    elif n < 65536:
        head = bytes([0x80 | opcode, 126]) + struct.pack("!H", n)
    else:
        head = bytes([0x80 | opcode, 127]) + struct.pack("!Q", n)
    return head + payload


def unframe(buf):
    """Returns (opcode, payload, rest) or None if more bytes are needed."""
    if len(buf) < 2:
        return None
    opcode = buf[0] & 0x0F
    masked = bool(buf[1] & 0x80)
    n = buf[1] & 0x7F
    off = 2
    if n == 126:
        if len(buf) < off + 2:
            return None
        n = struct.unpack("!H", buf[off:off + 2])[0]; off += 2
    elif n == 127:
        if len(buf) < off + 8:
            return None
        n = struct.unpack("!Q", buf[off:off + 8])[0]; off += 8
    mask = None
    if masked:
        if len(buf) < off + 4:
            return None
        mask = buf[off:off + 4]; off += 4
    if len(buf) < off + n:
        return None
    payload = bytearray(buf[off:off + n])
    if mask:
        for i in range(n):
            payload[i] ^= mask[i & 3]
    return opcode, bytes(payload), buf[off + n:]


def bridge(sock, tcp, label):
    """Pipe a WebSocket and a TCP socket until either ends.

    Byte counts make an immediate close diagnosable: 0 out means the module
    never wrote, >0 out with 0 in means the peer hung up on our handshake, and
    traffic both ways means the disconnect is protocol-level.
    """
    started = time.time()
    out = inb = 0
    buf = b""
    try:
        while True:
            ready, _, _ = select.select([sock, tcp], [], [], 60)
            if not ready:
                continue
            if tcp in ready:
                data = tcp.recv(65536)
                if not data:
                    break
                inb += len(data)
                sock.sendall(frame(data))
            if sock in ready:
                data = sock.recv(65536)
                if not data:
                    break
                buf += data
                while True:
                    got = unframe(buf)
                    if not got:
                        break
                    opcode, payload, buf = got
                    if opcode == 0x8:            # client closed
                        return
                    if opcode == 0x9:            # ping
                        sock.sendall(frame(payload, 0xA))
                    elif opcode in (0x1, 0x2):
                        out += len(payload)
                        tcp.sendall(payload)
    except OSError:
        pass
    finally:
        log("close %s -- %dB sent, %dB received, %dms"
            % (label, out, inb, (time.time() - started) * 1000))
        try:
            tcp.close()
        except OSError:
            pass


# ---- HTTPS proxy for the web services -------------------------------------
# Outside a Capacitor WebView the client rewrites its API calls through its own
# origin, keeping only the first label of the hostname:
#
#   webgate.arenanetworks.com/session/create.xml  ->  /webgate/session/create.xml
#
# That is the standard CORS workaround for a web deployment -- the page's own
# server is expected to proxy onward. So we do. Note this carries account
# traffic: the login POST goes through here.
#
# The map is needed because the rewrite throws the domain away, and the web
# services are NOT on arenanetworks.com -- that is only game and patch
# infrastructure. Reconstructing "<route>.arenanetworks.com" produced hostnames
# that do not exist anywhere.
PROXY_ROUTES = {
    "webgate": "webgate.ncplatform.net",
    "account": "account.arena.net",
    "help": "help.guildwars.com",
    "store": "store.guildwars.com",
    "www": "www.guildwars.com",
}
for _pair in filter(None, os.environ.get("GW_PROXY_ROUTES", "").split(",")):
    _r, _, _h = _pair.partition("=")
    if _r and _h:
        PROXY_ROUTES[_r.strip()] = _h.strip()

PROXY_TEMPLATE = os.environ.get("GW_PROXY_TEMPLATE")  # tests point this at a fixture
ROUTE_RE = re.compile(r"^/([a-z0-9][a-z0-9-]{0,30})(/.*)$", re.I)
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class Handler(SimpleHTTPRequestHandler):
    store = None      # ChunkStore, set by main()
    origins = set()   # what Origin the relay will accept
    proxy_http = None
    progress = None   # Progress, set by main()
    watchdog = None   # Watchdog, set by main() only when we opened the browser

    def log_message(self, fmt, *a):
        sys.stderr.write("  %s\n" % (fmt % a))

    def log_request(self, code="-", size="-"):
        """Routine requests are silent unless -v.

        A single boot issues ~1400 snapshot range reads and play issues more,
        so logging every one buries the lines that matter -- DNS, sockets, the
        proxy, errors -- in a wall of identical text. Anything that failed is
        still printed, because that is the reason to be looking at all.
        """
        if VERBOSE or (isinstance(code, int) and code >= 400):
            super().log_request(code, size)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        # No COOP/COEP: the module is single-threaded and uses no
        # SharedArrayBuffer, so cross-origin isolation is unnecessary.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # -- relay ---------------------------------------------------------------

    def _bail(self, code, why):
        log("DENY ws", why)
        self.wfile.write(b"HTTP/1.1 %d\r\n\r\n" % code)
        self.close_connection = True

    def _websocket(self, query):
        origin = self.headers.get("Origin")
        if origin and origin not in self.origins:
            return self._bail(403, "origin %s" % origin)

        dest = query.get("dest", [""])[0]
        m = re.match(r"^\[?([0-9a-fA-F:.]+)\]?:(\d+)$", dest)
        if not m:
            return self._bail(400, "malformed dest %r" % dest)
        host, port = m.group(1), int(m.group(2))

        if not is_public_ip(host) and not ALLOW_PRIVATE:
            return self._bail(403, "%s is not a public address -- loopback, LAN "
                              "and link-local are refused so this bridge cannot "
                              "reach hosts a page could not reach itself" % host)
        if port not in ALLOWED_PORTS:
            return self._bail(403, "port %d not allowed" % port)

        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            return self._bail(400, "no Sec-WebSocket-Key")

        # Connect TCP *before* completing the upgrade.
        #
        # The glue maps socket.onopen to _OnSocketOpen, so the moment the
        # WebSocket opens the module believes it has a live socket and starts
        # writing its handshake. If the upgrade completed first those bytes
        # would arrive mid-connect and be dropped -- the peer would never see a
        # handshake, the module would time out and reconnect, and the symptom
        # is an endless loop of sockets opening and dying. Connecting first
        # makes a 101 mean "TCP is established", so onopen never lies.
        label = "%s:%d" % (host, port)
        try:
            tcp = socket.create_connection((host, port), CONNECT_TIMEOUT)
        except OSError as e:
            log("connect FAILED", label, e)
            # 502 rather than a silent drop: the browser surfaces a failed
            # handshake, so the module sees a clean connect failure.
            return self._bail(502, "connect %s: %s" % (label, e))
        tcp.settimeout(None)
        log("open", label)

        accept = base64.b64encode(hashlib.sha1(key.encode() + WS_GUID).digest()).decode()
        self.wfile.write(
            b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
            b"Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n")
        self.wfile.flush()

        self.close_connection = True
        bridge(self.connection, tcp, label)

    def _dns(self, query):
        name = query.get("name", [""])[0]
        if not allowed_name(name):
            log("DENY dns", name, "(not in allowlist)")
            return self._text(HTTPStatus.FORBIDDEN, "domain not allowed\n")
        try:
            ip, how = lookup(name)
        except OSError as e:
            # Surface the reason: the browser only ever shows "502", and
            # NXDOMAIN vs SERVFAIL vs timeout point at very different problems.
            log("dns", name, "FAILED:", e)
            return self._text(HTTPStatus.BAD_GATEWAY, "lookup failed: %s\n" % e)
        log("dns", name, "->", ip, "(%s)" % how)
        self._text(HTTPStatus.OK, ip)

    def _ping(self, query):
        if self.watchdog:
            self.watchdog.ping(query.get("id", [""])[0], leaving="bye" in query)
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _text(self, status, body):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # -- ranges --------------------------------------------------------------

    def _parse_range(self, total):
        """(start, end) inclusive, None for a normal 200, or "invalid"."""
        header = self.headers.get("Range")
        if not header:
            return None
        m = RANGE_RE.match(header.strip())
        if not m:
            return None
        first, last = m.group(1), m.group(2)
        if first:
            start = int(first)
            end = int(last) if last else total - 1
        else:
            if not last:  # suffix form: bytes=-N -> the final N bytes
                return None
            start = max(0, total - int(last))
            end = total - 1
        if start >= total or start > end:
            self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            return "invalid"
        return start, min(end, total - 1)

    def _send_range(self, data, start, end, total, ctype):
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, total))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # -- proxy ---------------------------------------------------------------

    def _try_proxy(self):
        local = Path(self.translate_path(self.path.split("?")[0]))
        if local.exists():  # never shadow our own files
            return False
        m = ROUTE_RE.match(self.path)
        if not m:
            return False
        route, rest = m.group(1), m.group(2)

        if PROXY_TEMPLATE:
            url = PROXY_TEMPLATE.format(route=route) + rest
        else:
            host = PROXY_ROUTES.get(route.lower())
            if not host:
                # Fail loudly. Guessing a domain is what produced requests to
                # webgate.arenanetworks.com, a host that does not exist.
                self.send_error(HTTPStatus.BAD_GATEWAY,
                                "unknown proxy route %r -- known: %s"
                                % (route, ", ".join(sorted(PROXY_ROUTES))))
                return True
            url = "https://%s%s" % (host, rest)

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        # Drop the headers describing the hop to us rather than the request.
        skip = {"host", "connection", "content-length", "accept-encoding",
                "origin", "referer"}
        headers = {k: v for k, v in self.headers.items() if k.lower() not in skip}

        try:
            status, rheaders, data = self.proxy_http.request(
                self.command, url, body=body, headers=headers, tries=1,
                raise_4xx=False)
        except Exception as e:
            self.log_message("proxy %s %s FAILED: %s", self.command, url, e)
            self.send_error(HTTPStatus.BAD_GATEWAY, "proxy failed: %s" % e)
            return True

        self.log_message("proxy %s %s -> %d", self.command, url, status)
        self.send_response(status)
        for k, v in rheaders.items():
            if k.lower() not in ("transfer-encoding", "content-encoding",
                                 "content-length", "connection"):
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_POST(self):
        # sendBeacon posts, and the goodbye beacon is the whole point of it.
        from urllib.parse import urlparse, parse_qs
        parts = urlparse(self.path)
        if parts.path == "/ping":
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            return self._ping(parse_qs(parts.query))
        if not self._try_proxy():
            self.send_error(HTTPStatus.NOT_FOUND)

    do_PUT = do_POST

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        parts = urlparse(self.path)
        name, query = parts.path.lstrip("/"), parse_qs(parts.query)

        # The relay lives on this same port, so it is same-origin with the page
        # -- no CORS, and no second port for the harness to be told about.
        if self.headers.get("Upgrade", "").lower() == "websocket":
            return self._websocket(query)
        if parts.path == "/dns":
            return self._dns(query)

        if parts.path == "/ping":
            return self._ping(query)

        # The page is served before the client has finished downloading, so
        # this is how it knows what to draw.
        if name == "progress.json":
            body = json.dumps(self.progress.snapshot()).encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)

        # Virtual snapshot, backed by the chunk cache.
        if name == SNAPSHOT and self.store and not (Path(self.directory) / SNAPSHOT).exists():
            rng = self._parse_range(self.store.size)
            if rng == "invalid":
                return
            if rng is None:
                # Refuse whole-file reads of a 4.2 GB virtual object.
                return self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
                                       "Gw.snapshot is served from cached chunks; "
                                       "range requests only")
            start, end = rng
            try:
                data = self.store.read(start, end - start + 1)
            except FileNotFoundError as e:
                return self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, str(e))
            return self._send_range(data, start, end, self.store.size,
                                    "application/octet-stream")

        if self._try_proxy():
            return

        path = Path(self.translate_path(self.path))
        if path.is_file():
            rng = self._parse_range(path.stat().st_size)
            if rng == "invalid":
                return
            if rng is not None:
                start, end = rng
                with open(path, "rb") as fh:
                    fh.seek(start)
                    data = fh.read(end - start + 1)
                return self._send_range(data, start, end, path.stat().st_size,
                                        self.guess_type(str(path)))
        super().do_GET()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-d", "--dir", default=None, type=Path,
                    help="where the client files live (default: ./dist)")
    ap.add_argument("-p", "--port", type=int, default=8080)
    ap.add_argument("-c", "--cache", default=None, type=Path)
    ap.add_argument("-j", "--jobs", type=int, default=PREFETCH_JOBS,
                    help="concurrent chunk fetches, for every download this "
                         "makes (default %d). Throughput scales almost linearly "
                         "-- 8 gives ~3 MB/s, 16 ~7.5, 32 ~12 -- but this is "
                         "ArenaNet's production CDN and the access key is shared "
                         "by every install, so raising it is a decision about "
                         "their infrastructure, not just yours."
                         % PREFETCH_JOBS)
    ap.add_argument("--build", choices=["jspi", "asyncify", "both"], default="jspi",
                    help="jspi is 8.2MB and what Chrome picks; asyncify for Safari")
    ap.add_argument("--no-update", action="store_true", help="skip the update check")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="log every HTTP request (thousands during play)")
    ap.add_argument("--offline", action="store_true",
                    help="never fetch; 503 on a chunk that is not cached")
    ap.add_argument("--no-prefetch", action="store_true",
                    help="do not warm the recorded boot working set")
    ap.add_argument("-i", "--image", action="store_true",
                    help="download the whole 4.2 GB game image before starting, "
                         "instead of streaming it on demand. Resumable, and "
                         "afterwards the game needs no network for game data")
    args = ap.parse_args()

    global VERBOSE
    VERBOSE = args.verbose

    # Anchor on this file, not the working directory: a double-click starts in
    # $HOME on some desktops, which would scatter a 4 GB cache there.
    here = Path(__file__).resolve().parent
    check_install(here)
    dest = args.dir or here / "dist"
    cache = args.cache or here / "gwpatch-cache"

    dest.mkdir(parents=True, exist_ok=True)
    publish(here / "harness", dest)

    # Local, so the loading screen is dressed before the browser even opens.
    copy_art(here / "images", dest)
    publish(here / "fonts", dest / "fonts")

    progress = Progress()
    Handler.progress = progress
    stop = threading.Event()

    def work():
        """Fetch everything, reporting to the loading screen as we go.

        This runs after the server is up so the browser has something to show
        during a first run's 8.2 MB -- previously that was a silent wait in a
        terminal the user may never have looked at.
        """
        try:
            if not args.no_update and not args.offline:
                update(dest, cache, args.build, args.jobs, progress)
        except Exception as e:
            log("update failed: %s" % e)
            if not any(dest.glob("Gw*")):
                progress.set(phase="error",
                             error="Could not download the game: %s" % e)
                return
            log("carrying on with what is already downloaded")

        index = dest / "snapshot-chunks.json"
        if index.exists():
            Handler.store = ChunkStore(index, None if args.offline else patch_http())
            have = sum(1 for h in Handler.store.hashes
                       if (Handler.store.cache / h).exists())
            log("snapshot: %d/%d chunks cached%s"
                % (have, len(Handler.store.hashes), " (offline)" if args.offline else ""))
        elif not args.offline:
            progress.set(phase="error", error="No snapshot index was downloaded.")
            return

        store = Handler.store

        # --image holds the game back until the whole image is local. The page
        # is already up showing this, so the wait is visible rather than a
        # terminal nobody is watching.
        if args.image and store:
            if not store.download_all(progress, args.jobs, stop):
                return

        progress.set(phase="ready", label="Ready", done=True, error=None)

        # Only now: the page can boot while this runs, and every chunk warmed
        # here is one the game does not have to wait on a round trip for.
        # After --image there is nothing left to warm, so this is a no-op.
        if store and not args.no_prefetch:
            store.prefetch(progress, args.jobs)

    def record():
        """Persist the working set periodically, so a run that is killed rather
        than closed still leaves a usable list behind."""
        while True:
            time.sleep(10)
            store = Handler.store
            if store:
                try:
                    store.save_touched()
                except OSError:
                    pass

    Handler.proxy_http = Http()
    Handler.origins = {"http://127.0.0.1:%d" % args.port,
                       "http://localhost:%d" % args.port}

    # Threaded: the module issues concurrent reads and a serial server
    # deadlocks -- and each relayed socket holds a thread for its lifetime.
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port),
                                partial(Handler, directory=str(dest)))
    url = "http://127.0.0.1:%d/" % args.port
    log("serving %s at %s" % (dest, url))
    log("relay: same origin, domains %s, ports %s"
        % (", ".join(ALLOWED_DOMAINS), ", ".join(str(p) for p in sorted(ALLOWED_PORTS))))
    if ALLOW_PRIVATE:
        log("relay: WARNING -- GW_RELAY_ALLOW_PRIVATE=1, private addresses may "
            "be dialled. This is for tests; do not browse with it set.")

    # Browser first, then the download: the point of the loading screen is that
    # the user sees progress instead of an apparently idle terminal.
    if not args.no_browser:
        # Only with a browser of our own: under --no-browser the caller is a
        # script or a developer, and nothing would ever ping.
        Handler.watchdog = Watchdog(httpd)
        threading.Thread(target=Handler.watchdog.run, daemon=True).start()

        def launch():
            webbrowser.open(url)
            # After, not before: if opening the browser fails, the error is on
            # a window the user can still see.
            minimise_console()
        threading.Timer(0.3, launch).start()
    threading.Thread(target=work, daemon=True).start()
    threading.Thread(target=record, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        # Say so explicitly: interrupting a 4 GB --image run looks like a crash
        # otherwise, and the next run resumes rather than starting over.
        stop.set()
        print("\nstopped" + (" -- rerun to resume the image download" if args.image else ""))
    finally:
        httpd.server_close()
        if Handler.store:
            Handler.store.save_touched()


if __name__ == "__main__":
    main()
