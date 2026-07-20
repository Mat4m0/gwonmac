#!/usr/bin/env python3
"""Standalone patcher for the Guild Wars Reforged web client VFS.

Implements the chunk-store protocol used by the mobile/web client:
  GET {root}/manifest.json   -> {compressionMode, chunkSize, directories[], files[]}
  GET {root}/{hash}.bin      -> one chunk, gzip-compressed when compressionMode == "gzip"

Files are the ordered concatenation of their chunks. The store is
content-addressed, so caching chunks by hash gives incremental update for free:
a later run against a newer manifest only fetches hashes that actually changed.

Acquisition and assembly are separate phases. Chunks are independent objects
with no ordering dependency, so they are fetched concurrently over a pooled
connection into the cache; assembly then walks the cache in order. Everything
downstream of the cache stays sequential and deterministic.

Needs an access key -- see gwkey.py, which lifts one out of a base.apk.

  python3 gwpatch.py                 # list every file in the manifest
  python3 gwpatch.py Gw.wasm         # reassemble and write Gw.wasm
  python3 gwpatch.py Gw.wasm -j 8    # ...with 8 concurrent fetches
"""

import argparse
import gzip
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter

ROOT = "https://patching.1.arenanetworks.com"
UA = "gwpatch/0.2 (interop research)"

_HASHES = {32: "md5", 40: "sha1", 64: "sha256"}

# Fail fast rather than burning retries on something a retry cannot fix.
_FATAL = (401, 403, 404)


def read_key(path):
    try:
        key = Path(path).read_text().strip()
    except OSError as e:
        sys.exit("could not read key file %s: %s\nrun gwkey.py against a base.apk first" % (path, e))
    if not key:
        sys.exit("key file %s is empty" % path)
    return key


def make_session(key, jobs):
    """One pooled session for the whole run.

    Connection reuse matters more than concurrency here: without it every chunk
    pays a fresh TCP + TLS handshake, which for many small objects dominates the
    transfer itself.
    """
    s = requests.Session()
    s.headers.update({"X-Access-Key": key, "User-Agent": UA})
    adapter = HTTPAdapter(pool_connections=jobs, pool_maxsize=jobs)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def get(session, url, tries=4):
    """Fetch with backoff. Modest concurrency, honest UA -- this is someone
    else's production CDN, not a load test."""
    for attempt in range(tries):
        try:
            r = session.get(url, timeout=60)
            if r.status_code in _FATAL:
                r.raise_for_status()
            r.raise_for_status()
            return r.content
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in _FATAL:
                raise
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
        except requests.RequestException:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


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


def store_chunk(cache, h, data):
    """Write a cache entry atomically.

    Assembly trusts any file present in the cache, so a half-written entry left
    by an interrupted run would be silently baked into the output. Write to a
    unique temp name and rename -- rename is atomic within a filesystem, so an
    entry is either absent or complete.
    """
    tmp = cache / ("%s.%d.tmp" % (h, os.getpid()))
    tmp.write_bytes(data)
    os.replace(tmp, cache / h)


def prefetch(session, mf, hashes, cache, jobs, algo):
    """Fetch every missing chunk concurrently into the cache."""
    missing = sorted({h for h in hashes if not (cache / h).exists()})
    if not missing:
        print("  all %d chunks already cached" % len(set(hashes)), file=sys.stderr)
        return

    done = 0
    lock = threading.Lock()

    def fetch(h):
        data = get(session, "%s/%s.bin" % (ROOT.rstrip("/"), h))
        if mf.compression == "gzip":
            data = gzip.decompress(data)
        if algo and hashlib.new(algo, data).hexdigest() != h.lower():
            raise ValueError("hash mismatch on chunk %s" % h)
        store_chunk(cache, h, data)

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(fetch, h): h for h in missing}
        try:
            for fut in as_completed(futures):
                fut.result()  # re-raise worker failures here
                with lock:
                    done += 1
                    print("\r  fetched %d/%d chunks" % (done, len(missing)),
                          end="", file=sys.stderr, flush=True)
        except BaseException:
            # Don't keep hammering the CDN once something has gone wrong.
            for f in futures:
                f.cancel()
            raise
    print(file=sys.stderr)


def assemble(mf, entry, out, cache):
    """Concatenate cached chunks in order, checking sizes as we go."""
    hashes = entry["chunkHashes"]
    total = len(hashes)
    with open(out, "wb") as fh:
        for i, h in enumerate(hashes):
            data = (cache / h).read_bytes()
            # every chunk is chunkSize except the last, which is the remainder
            want = mf.chunk_size if i < total - 1 else entry["size"] - mf.chunk_size * i
            if len(data) != want:
                raise ValueError("chunk %d (%s): got %d bytes, want %d" % (i, h, len(data), want))
            fh.write(data)

    got = out.stat().st_size
    if got != entry["size"]:
        raise ValueError("assembled size %d != manifest size %d" % (got, entry["size"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?",
                    help="file to fetch, matched on suffix (omit to list)")
    ap.add_argument("-k", "--key-file", default="access.key",
                    help="file holding the access key (default: access.key)")
    ap.add_argument("-c", "--cache", default="gwpatch-cache", type=Path,
                    help="chunk cache directory (default: gwpatch-cache)")
    ap.add_argument("-o", "--out", help="output path (default: the file's basename)")
    ap.add_argument("-j", "--jobs", type=int, default=4,
                    help="concurrent chunk fetches (default: 4)")
    args = ap.parse_args()

    if args.jobs < 1:
        sys.exit("--jobs must be >= 1")
    if args.jobs > 16:
        print("warning: --jobs %d is aggressive against a third-party CDN; "
              "past ~8 you are mostly risking rate limiting, not saving time"
              % args.jobs, file=sys.stderr)

    key = read_key(args.key_file)
    session = make_session(key, args.jobs)
    mf = Manifest(json.loads(get(session, "%s/manifest.json" % ROOT)))

    print("compression=%s chunkSize=%d files=%d"
          % (mf.compression, mf.chunk_size, len(mf.files)))

    if not args.target:
        for path, f in sorted(mf.files.items()):
            print("  %12d  %5d chunks  %s" % (f["size"], len(f["chunkHashes"]), path))
        return

    match = next((p for p in mf.files if p.lower().endswith(args.target.lower())), None)
    if not match:
        sys.exit("not in manifest: %s" % args.target)

    entry = mf.files[match]
    hashes = entry["chunkHashes"]
    algo = _HASHES.get(len(hashes[0]))
    unique = len(set(hashes))
    print("%s: %d bytes, %d chunks (%d unique), %s"
          % (match, entry["size"], len(hashes), unique, algo or "unknown hash"))

    args.cache.mkdir(parents=True, exist_ok=True)
    out = Path(args.out) if args.out else Path(Path(match).name)

    t0 = time.time()
    prefetch(session, mf, hashes, args.cache, args.jobs, algo)
    assemble(mf, entry, out, args.cache)
    print("wrote %s (%d bytes) in %.1fs" % (out, out.stat().st_size, time.time() - t0))


if __name__ == "__main__":
    main()
