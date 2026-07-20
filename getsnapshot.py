#!/usr/bin/env python3
"""Download Gw.snapshot, with progress.

The whole image is 4.2 GB in 16,023 chunks. gwpatch.py can already fetch it,
but reports only a chunk counter, which tells you very little over a download
this long. This adds rate, ETA and a bar, and defaults to ten concurrent
fetches.

Chunks land in the content-addressed cache, so this is resumable: interrupt it
and run it again, and it picks up where it stopped. Nothing already present is
re-fetched.

  python3 getsnapshot.py                  # fill the chunk cache
  python3 getsnapshot.py --out Gw.snapshot  # ...and assemble the file too
  python3 getsnapshot.py -j 4             # gentler on the CDN

By default it does NOT write the 4.2 GB file. run.py serves the snapshot
straight out of the chunk cache, so assembling it doubles the disk cost for no
benefit unless you want the file itself.
"""

import argparse
import hashlib
import json
import os
import shutil
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import gwpatch

SNAPSHOT = "Gw.snapshot"

stop = threading.Event()


def human(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return "%.1f%s" % (n, unit) if unit != "B" else "%dB" % n
        n /= 1024.0


def duration(seconds):
    if seconds is None or seconds != seconds or seconds in (float("inf"),):
        return "--:--"
    seconds = int(seconds)
    if seconds >= 3600:
        return "%d:%02d:%02d" % (seconds // 3600, (seconds % 3600) // 60, seconds % 60)
    return "%02d:%02d" % (seconds // 60, seconds % 60)


class Progress:
    """One rewriting line: bar, bytes, rate, ETA.

    Rate is measured over a trailing window rather than the whole run, so a
    slow patch part-way through is visible instead of being averaged away.
    """

    WINDOW = 30.0

    def __init__(self, total_bytes, already):
        self.total = total_bytes
        self.done = already
        self.start = time.time()
        self.base = already
        self.samples = [(self.start, already)]
        self.lock = threading.Lock()
        self.last_draw = 0.0

    def advance(self, n):
        with self.lock:
            self.done += n
            now = time.time()
            self.samples.append((now, self.done))
            cutoff = now - self.WINDOW
            while len(self.samples) > 2 and self.samples[0][0] < cutoff:
                self.samples.pop(0)
            if now - self.last_draw >= 0.2:
                self.last_draw = now
                self.draw()

    def rate(self):
        if len(self.samples) < 2:
            return 0.0
        (t0, b0), (t1, b1) = self.samples[0], self.samples[-1]
        return (b1 - b0) / (t1 - t0) if t1 > t0 else 0.0

    def draw(self, final=False):
        frac = self.done / self.total if self.total else 1.0
        width = 32
        filled = int(width * frac)
        bar = "#" * filled + "-" * (width - filled)
        rate = self.rate()
        eta = (self.total - self.done) / rate if rate > 0 else None
        line = "\r  [%s] %5.1f%%  %s/%s  %s/s  ETA %s " % (
            bar, frac * 100, human(self.done), human(self.total),
            human(rate), duration(eta))
        sys.stderr.write(line)
        if final:
            sys.stderr.write("\n")
        sys.stderr.flush()


def check_space(path, needed):
    try:
        free = shutil.disk_usage(path).free
    except OSError:
        return
    if free < needed:
        sys.exit("not enough space in %s: need %s, have %s"
                 % (path, human(needed), human(free)))
    if free < needed * 2:
        print("warning: %s free, this needs %s" % (human(free), human(needed)),
              file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-k", "--key-file", default="access.key")
    ap.add_argument("-c", "--cache", default="gwpatch-cache", type=Path)
    ap.add_argument("-j", "--jobs", type=int, default=10,
                    help="concurrent chunk fetches (default: 10)")
    ap.add_argument("-o", "--out", type=Path,
                    help="also assemble the full file here (needs another 4.2GB)")
    args = ap.parse_args()

    if args.jobs < 1:
        sys.exit("--jobs must be >= 1")
    if args.jobs > 16:
        print("warning: --jobs %d against someone else's CDN is not neighbourly; "
              "past ~10 you are mostly risking rate limiting" % args.jobs,
              file=sys.stderr)

    key = gwpatch.read_key(args.key_file)
    session = gwpatch.make_session(key, args.jobs)

    print("fetching manifest ...")
    mf = gwpatch.Manifest(json.loads(
        gwpatch.get(session, "%s/manifest.json" % gwpatch.ROOT)))
    match = next((p for p in mf.files if p.split("/")[-1] == SNAPSHOT), None)
    if not match:
        sys.exit("%s is not in the manifest" % SNAPSHOT)

    entry = mf.files[match]
    hashes = entry["chunkHashes"]
    algo = gwpatch._HASHES.get(len(hashes[0]))
    args.cache.mkdir(parents=True, exist_ok=True)

    # Deduplicate: identical chunks are stored once.
    unique = list(dict.fromkeys(hashes))
    missing = [h for h in unique if not (args.cache / h).exists()]
    have_bytes = entry["size"] - len(missing) * mf.chunk_size
    have_bytes = max(0, min(have_bytes, entry["size"]))

    print("%s: %s in %d chunks (%d unique)"
          % (SNAPSHOT, human(entry["size"]), len(hashes), len(unique)))
    print("cached: %d/%d chunks -- %d to fetch"
          % (len(unique) - len(missing), len(unique), len(missing)))

    if not missing:
        print("nothing to download")
    else:
        check_space(args.cache, len(missing) * mf.chunk_size)
        print("downloading with %d workers (ctrl-c to stop; rerun to resume)"
              % args.jobs)

        prog = Progress(entry["size"], have_bytes)
        failures = []

        def fetch(h):
            if stop.is_set():
                return
            try:
                data = gwpatch.get(session, "%s/%s.bin" % (gwpatch.ROOT.rstrip("/"), h))
                if mf.compression == "gzip":
                    import gzip
                    data = gzip.decompress(data)
                if algo and hashlib.new(algo, data).hexdigest() != h.lower():
                    raise ValueError("hash mismatch")
                gwpatch.store_chunk(args.cache, h, data)
                prog.advance(len(data))
            except Exception as e:  # noqa: BLE001
                failures.append((h, str(e)))
                stop.set()

        def on_sigint(*_):
            if not stop.is_set():
                stop.set()
                sys.stderr.write("\n  stopping -- cached chunks are kept, rerun to resume\n")
        signal.signal(signal.SIGINT, on_sigint)

        t0 = time.time()
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            list(pool.map(fetch, missing))
        prog.draw(final=True)

        if failures:
            print("stopped after %d failure(s); first: %s -- %s"
                  % (len(failures), failures[0][0][:12], failures[0][1]), file=sys.stderr)
            return 1
        if stop.is_set():
            return 1
        print("fetched %d chunks in %s" % (len(missing), duration(time.time() - t0)))

    if args.out:
        check_space(args.out.parent if args.out.parent.name else Path("."), entry["size"])
        print("assembling %s ..." % args.out)
        gwpatch.assemble(mf, entry, args.out, args.cache)
        print("wrote %s (%s)" % (args.out, human(args.out.stat().st_size)))
    else:
        print("chunk cache is complete; run.py serves the snapshot from it directly.\n"
              "pass --out to write the 4.2GB file as well.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
