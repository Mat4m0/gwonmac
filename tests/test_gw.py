#!/usr/bin/env python3
"""Tests for gw.py -- framing, the address rules, ranges, the lazy snapshot
and the proxy.

Everything ArenaNet-side is replaced by local fixtures, so this runs offline.
What is deliberately NOT covered is the relay's happy path: dialling is
restricted to public addresses, so a loopback fixture cannot stand in for a
real peer. Every branch that decides whether to open a socket at all is
covered, which is where a mistake would be most costly.

  python3 tests/test_gw.py
"""

import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gw

FAILED = []


def check(name, cond, extra=""):
    print("%s %s%s" % ("ok  " if cond else "FAIL", name, (" -- " + extra) if not cond else ""))
    if not cond:
        FAILED.append(name)


# ---- framing --------------------------------------------------------------

def test_framing():
    for n, name in ((5, "7-bit"), (200, "16-bit"), (70000, "64-bit")):
        payload = os.urandom(n)
        f = gw.frame(payload)
        check("frame %s length" % name, f[0] == 0x82 and len(f) > n)

        # Mask it the way a browser would, then read it back.
        mask = os.urandom(4)
        body = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        hdr = bytearray(f[:len(f) - n])
        hdr[1] |= 0x80
        wire = bytes(hdr) + mask + body
        got = gw.unframe(wire)
        check("unframe %s" % name, got and got[0] == 0x2 and got[1] == payload)
        check("unframe %s partial yields None" % name, gw.unframe(wire[:-1]) is None)

    # Server frames must be unmasked with FIN set.
    check("server frame unmasked", not (gw.frame(b"x")[1] & 0x80))

    # Two frames in one chunk: the second must survive as `rest`.
    a, b = os.urandom(4), os.urandom(4)
    def masked(p):
        m = os.urandom(4)
        return bytes([0x82, 0x80 | len(p)]) + m + bytes(x ^ m[i & 3] for i, x in enumerate(p))
    got = gw.unframe(masked(a) + masked(b))
    check("coalesced frames", got and got[1] == a and gw.unframe(got[2])[1] == b)


# ---- allowlists -----------------------------------------------------------

def test_allowlists():
    for name in ("arenanetworks.com", "File1.ArenaNetworks.com", "guildwars.com",
                 "a.b.guildwars.com", "arenanetworks.com."):
        check("allow %s" % name, gw.allowed_name(name))
    # The suffix check must not be foolable by a lookalike.
    for name in ("arenanetworks.com.evil.com", "evil.com", "notarenanetworks.com",
                 "xarenanetworks.com", ""):
        check("deny %s" % (name or "(empty)"), not gw.allowed_name(name))

    for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1",
               "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.1.2",
               "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::1",
               "::ffff:127.0.0.1", "not.an.ip", "1.2.3"):
        check("not dialable %s" % ip, not gw.is_public_ip(ip))
    # 172.15 and 172.32 sit just outside RFC1918 and must not be caught by it.
    for ip in ("8.8.8.8", "54.196.189.234", "172.15.0.1", "172.32.0.1",
               "2606:4700::1", "::ffff:8.8.8.8"):
        check("dialable %s" % ip, gw.is_public_ip(ip))


# ---- DNS wire format ------------------------------------------------------

def test_dns_parse():
    """Feed the parser a hand-built reply, including a compression pointer."""
    name = b"\x04File\x02gw\x03com\x00"
    # The answer uses a compression pointer back to the question's name, which
    # is what every real resolver emits and the parser has to skip correctly.
    answer = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + bytes([9, 8, 7, 6])
    served = {}

    def reply(qid, rcode=0):
        return (struct.pack("!HHHHHH", qid, 0x8180 | rcode, 1, 1, 0, 0)
                + name + struct.pack("!HH", 1, 1) + answer)

    real = socket.socket

    class FakeSock:
        def __init__(self, *a): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def settimeout(self, t): pass
        def sendto(self, data, addr): served["sent"] = data
        def recvfrom(self, n):
            qid = struct.unpack("!H", served["sent"][:2])[0] ^ served.get("corrupt", 0)
            return reply(qid, served.get("rcode", 0)), None

    socket.socket = FakeSock
    try:
        check("dns parses A record", gw._dns_query("File.gw.com", "1.1.1.1") == "9.8.7.6")
        sent = served["sent"]
        check("dns query is well formed",
              sent[2:4] == b"\x01\x00" and b"\x04File" in sent and sent[-4:] == b"\x00\x01\x00\x01")

        # A reply whose id does not match the query must be refused -- that
        # check is the only thing standing between us and an off-path forgery.
        served["corrupt"] = 0xFFFF
        try:
            gw._dns_query("File.gw.com", "1.1.1.1")
            check("dns rejects mismatched id", False)
        except OSError:
            check("dns rejects mismatched id", True)
        served["corrupt"] = 0

        served["rcode"] = 3
        try:
            gw._dns_query("File.gw.com", "1.1.1.1")
            check("dns raises on NXDOMAIN", False)
        except OSError as e:
            check("dns raises on NXDOMAIN", "rcode 3" in str(e), str(e))
    finally:
        socket.socket = real


# ---- fixtures -------------------------------------------------------------

CHUNK = 4096


def build_snapshot(tmp, cached_only=True):
    """A synthetic chunked file. Returns (truth_bytes, index_path)."""
    cache = tmp / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    # Deliberately not a whole number of chunks, so the final short chunk is
    # exercised -- that boundary is where an off-by-one would hide.
    truth = os.urandom(CHUNK * 3 + 111)
    hashes = []
    for i in range(0, len(truth), CHUNK):
        piece = truth[i:i + CHUNK]
        h = hashlib.sha256(piece).hexdigest()
        hashes.append(h)
        if cached_only or i < CHUNK:
            (cache / h).write_bytes(piece)
    index = tmp / "snapshot-chunks.json"
    index.write_text(json.dumps({"size": len(truth), "chunkSize": CHUNK,
                                 "cache": str(cache), "chunkHashes": hashes}))
    return truth, index


class Origin(BaseHTTPRequestHandler):
    """Stands in for the upstream web services behind the proxy."""
    def log_message(self, *a): pass

    def _reply(self):
        body = json.dumps({"path": self.path, "method": self.command}).encode()
        code = 401 if "denied" in self.path else 200
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = _reply


def serve(directory, port):
    httpd = ThreadingHTTPServer(("127.0.0.1", port),
                                partial(gw.Handler, directory=str(directory)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def req(url, rng=None, method="GET", body=None, headers=None):
    r = Request(url, data=body, method=method, headers=headers or {})
    if rng:
        r.add_header("Range", rng)
    try:
        with urlopen(r, timeout=10) as resp:
            return resp.status, resp.headers, resp.read()
    except HTTPError as e:
        return e.code, e.headers, e.read()


# ---- server ---------------------------------------------------------------

def test_server(tmp):
    truth, index = build_snapshot(tmp)
    (tmp / "index.html").write_text("<html>harness</html>")
    (tmp / "Gw.jspi.wasm").write_bytes(b"\0asm" + os.urandom(500))

    origin = ThreadingHTTPServer(("127.0.0.1", 0), Origin)
    threading.Thread(target=origin.serve_forever, daemon=True).start()
    gw.PROXY_TEMPLATE = "http://127.0.0.1:%d/{route}" % origin.server_address[1]

    gw.Handler.store = gw.ChunkStore(index, None)  # offline: no fetching
    gw.Handler.proxy_http = gw.Http()
    gw.Handler.origins = {"http://127.0.0.1:8199"}
    httpd = serve(tmp, 8199)
    base = "http://127.0.0.1:8199"

    try:
        # -- mime and ranges on a real file
        s, h, b = req(base + "/Gw.jspi.wasm")
        check("wasm mime", h.get("Content-Type") == "application/wasm", h.get("Content-Type"))
        check("accept-ranges advertised", h.get("Accept-Ranges") == "bytes")

        whole = (tmp / "Gw.jspi.wasm").read_bytes()
        s, h, b = req(base + "/Gw.jspi.wasm", "bytes=10-19")
        check("range 206", s == 206 and b == whole[10:20], "%s %d" % (s, len(b)))
        check("content-range", h.get("Content-Range") == "bytes 10-19/%d" % len(whole))
        s, h, b = req(base + "/Gw.jspi.wasm", "bytes=-8")
        check("suffix range", s == 206 and b == whole[-8:])
        s, _, _ = req(base + "/Gw.jspi.wasm", "bytes=999999-")
        check("range past end 416", s == 416, str(s))

        # -- the virtual snapshot
        s, _, b = req(base + "/Gw.snapshot", "bytes=0-31")
        check("snapshot head", s == 206 and b == truth[:32])
        s, _, b = req(base + "/Gw.snapshot", "bytes=%d-%d" % (CHUNK - 4, CHUNK + 3))
        check("snapshot across chunk boundary", s == 206 and b == truth[CHUNK - 4:CHUNK + 4])
        last = CHUNK * 3
        s, _, b = req(base + "/Gw.snapshot", "bytes=%d-%d" % (last, len(truth) - 1))
        check("snapshot short final chunk", s == 206 and b == truth[last:])
        s, _, _ = req(base + "/Gw.snapshot")
        check("snapshot whole-file refused", s == 416, str(s))

        # -- a chunk that is not cached, with no session to fetch it
        truth2, index2 = build_snapshot(tmp / "partial", cached_only=False)
        gw.Handler.store = gw.ChunkStore(index2, None)
        s, _, _ = req(base + "/Gw.snapshot", "bytes=0-15")
        check("uncached chunk 0 still served", s == 206)
        s, _, _ = req(base + "/Gw.snapshot", "bytes=%d-%d" % (CHUNK, CHUNK + 15))
        check("missing chunk 503", s == 503, str(s))
        gw.Handler.store = gw.ChunkStore(index, None)

        # -- proxy
        s, _, b = req(base + "/webgate/session/create.xml")
        check("proxy GET", s == 200 and json.loads(b)["path"] == "/webgate/session/create.xml",
              b[:80].decode("utf8", "replace"))
        s, _, b = req(base + "/webgate/post", method="POST", body=b"hello",
                      headers={"Content-Type": "text/plain"})
        check("proxy POST", s == 200 and json.loads(b)["method"] == "POST")
        s, _, _ = req(base + "/webgate/denied")
        check("proxy passes upstream 401 through", s == 401, str(s))

        gw.PROXY_TEMPLATE = None
        s, _, b = req(base + "/nosuchroute/x")
        check("unknown route 502s by name", s == 502 and b"nosuchroute" in b, str(s))
        s, _, b = req(base + "/index.html")
        check("local files are not proxied", s == 200 and b"harness" in b)

        # -- dns denial
        s, _, b = req(base + "/dns?name=arenanetworks.com.evil.com")
        check("dns lookalike denied", s == 403, str(s))
        s, _, b = req(base + "/dns?name=169.254.169.254")
        check("dns raw ip denied", s == 403, str(s))

        # -- websocket denial paths
        for dest, why, want in (("127.0.0.1:6112", "loopback", 403),
                                ("169.254.169.254:80", "link-local", 403),
                                ("10.0.0.1:6112", "RFC1918", 403),
                                ("192.168.0.5:6112", "LAN", 403),
                                ("8.8.8.8:22", "port not allowed", 403),
                                ("8.8.8.8", "malformed dest", 400)):
            check("ws deny %s" % why, ws_status(8199, dest) == want,
                  str(ws_status(8199, dest)))
        check("ws deny foreign origin",
              ws_status(8199, "8.8.8.8:6112", origin="http://evil.example") == 403)
    finally:
        httpd.shutdown()
        origin.shutdown()


def ws_status(port, dest, origin="http://127.0.0.1:8199"):
    s = socket.create_connection(("127.0.0.1", port), 10)
    try:
        key = base64.b64encode(os.urandom(16)).decode()
        r = ("GET /?dest=%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\n"
             "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
             "Sec-WebSocket-Version: 13\r\nOrigin: %s\r\n\r\n" % (dest, port, key, origin))
        s.sendall(r.encode())
        head = b""
        while b"\r\n" not in head:
            b_ = s.recv(1)
            if not b_:
                return None
            head += b_
        return int(head.split()[1])
    finally:
        s.close()


# ---- manifest -------------------------------------------------------------

def test_manifest():
    raw = {"compressionMode": "none", "chunkSize": 4,
           "files": [{"name": "a.bin", "size": 6, "chunkHashes": ["x", "y"]}]}
    mf = gw.Manifest(raw)
    check("manifest flat file", mf.find("a.bin") == "a.bin")

    bad = dict(raw, files=[{"name": "a", "size": 99, "chunkHashes": ["x"]}])
    try:
        gw.Manifest(bad)
        check("manifest rejects chunk count mismatch", False)
    except ValueError:
        check("manifest rejects chunk count mismatch", True)

    try:
        gw.Manifest(dict(raw, compressionMode="brotli"))
        check("manifest rejects unknown compression", False)
    except ValueError:
        check("manifest rejects unknown compression", True)


def test_lazy_fetch(tmp):
    """A chunk that is not cached must be fetched once, verified, and kept."""
    truth, index = build_snapshot(tmp, cached_only=False)  # only chunk 0 on disk
    idx = json.loads(index.read_text())
    cache = Path(idx["cache"])
    pieces = {h: truth[i * CHUNK:(i + 1) * CHUNK]
              for i, h in enumerate(idx["chunkHashes"])}

    calls = []
    class FakeHttp:
        def get(self, url, tries=4):
            h = url.rsplit("/", 1)[-1][:-4]
            calls.append(h)
            time.sleep(0.05)  # widen the window for the duplicate-fetch race
            return pieces[h]

    store = gw.ChunkStore(index, FakeHttp())
    check("lazy read is correct", store.read(CHUNK, 16) == truth[CHUNK:CHUNK + 16])
    check("lazy fetch hit the network once", calls == [idx["chunkHashes"][1]], str(calls))
    check("fetched chunk was cached", (cache / idx["chunkHashes"][1]).exists())

    calls.clear()
    store.read(CHUNK, 16)
    check("second read uses the cache", calls == [], str(calls))

    # Concurrent readers of one uncached chunk must fetch it exactly once.
    calls.clear()
    store2 = gw.ChunkStore(index, FakeHttp())
    for h in idx["chunkHashes"][2:]:
        (cache / h).unlink(missing_ok=True)
    threads = [threading.Thread(target=lambda: store2.read(CHUNK * 2, 8)) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    check("concurrent readers fetch once", len(calls) == 1, str(calls))

    # A chunk whose bytes do not match its hash must be refused, not stored.
    bad_idx = tmp / "bad.json"
    fake_hash = hashlib.sha256(b"nope").hexdigest()
    bad_idx.write_text(json.dumps({**idx, "chunkHashes": [fake_hash], "size": 8}))
    class LyingHttp:
        def get(self, url, tries=4): return b"not the right bytes"
    try:
        gw.ChunkStore(bad_idx, LyingHttp()).read(0, 8)
        check("hash mismatch refused", False)
    except ValueError:
        check("hash mismatch refused", True)
    check("bad chunk not cached", not (cache / fake_hash).exists())


def test_boot_recording(tmp):
    """The working set is recorded as it is served, and prefetched next time."""
    truth, index = build_snapshot(tmp, cached_only=False)  # only chunk 0 cached
    idx = json.loads(index.read_text())
    cache = Path(idx["cache"])
    pieces = {h: truth[i * CHUNK:(i + 1) * CHUNK]
              for i, h in enumerate(idx["chunkHashes"])}

    calls = []
    class FakeHttp:
        def get(self, url, tries=4):
            h = url.rsplit("/", 1)[-1][:-4]
            calls.append(h)
            return pieces[h]

    store = gw.ChunkStore(index, FakeHttp())
    store.read(CHUNK, 16)          # chunk 1
    store.read(CHUNK * 2, 16)      # chunk 2
    check("touched set recorded", store.touched == {1, 2}, str(store.touched))

    store.save_touched()
    got = json.loads(store.boot_list.read_text())
    check("boot list written", got["chunks"] == [1, 2], str(got["chunks"]))

    # A later, shorter boot must not shrink the list -- an early abort would
    # otherwise throw away everything a full boot learned.
    store2 = gw.ChunkStore(index, FakeHttp())
    store2.read(0, 16)
    store2.save_touched()
    got = json.loads(store2.boot_list.read_text())
    check("boot list merges rather than replaces", got["chunks"] == [0, 1, 2],
          str(got["chunks"]))

    # Prefetch warms exactly what is missing, and nothing already cached.
    for h in idx["chunkHashes"]:
        (cache / h).unlink(missing_ok=True)
    (cache / idx["chunkHashes"][1]).write_bytes(pieces[idx["chunkHashes"][1]])
    calls.clear()
    store3 = gw.ChunkStore(index, FakeHttp())
    store3.prefetch(gw.Progress(), jobs=2)
    check("prefetch fetches only uncached working-set chunks",
          sorted(calls) == sorted([idx["chunkHashes"][0], idx["chunkHashes"][2]]),
          str(len(calls)))

    # Offline must not attempt any of this.
    calls.clear()
    gw.ChunkStore(index, None).prefetch(gw.Progress())
    check("prefetch is a no-op offline", calls == [], str(calls))


def test_download_all(tmp):
    """--image: fetch every chunk, resumably, and refuse if the disk is short."""
    truth, index = build_snapshot(tmp, cached_only=False)  # only chunk 0 cached
    idx = json.loads(index.read_text())
    cache = Path(idx["cache"])
    pieces = {h: truth[i * CHUNK:(i + 1) * CHUNK]
              for i, h in enumerate(idx["chunkHashes"])}
    calls = []

    class FakeHttp:
        def get(self, url, tries=4):
            h = url.rsplit("/", 1)[-1][:-4]
            calls.append(h)
            return pieces[h]

    store = gw.ChunkStore(index, FakeHttp())
    prog = gw.Progress()
    ok = store.download_all(prog, 2, threading.Event())
    check("download_all reports success", ok is True)
    check("download_all fetched every missing chunk",
          len(calls) == len(idx["chunkHashes"]) - 1, str(len(calls)))
    check("whole image is now cached",
          all((cache / h).exists() for h in idx["chunkHashes"]))
    s = prog.snapshot()
    check("progress reached the full size", s["received"] == s["total"] == len(truth),
          "%s/%s" % (s["received"], s["total"]))

    # Resume: nothing left to do, and it must not refetch.
    calls.clear()
    check("second run is a no-op",
          store.download_all(gw.Progress(), 2, threading.Event()) is True and calls == [],
          str(calls))

    # A stop request mid-run must abandon rather than finish.
    for h in idx["chunkHashes"][1:]:
        (cache / h).unlink()
    ev = threading.Event(); ev.set()
    calls.clear()
    check("stop event abandons the download",
          store.download_all(gw.Progress(), 2, ev) is False and calls == [], str(calls))

    # Not enough disk: refuse up front rather than fail part-way through.
    real = gw.shutil.disk_usage
    gw.shutil.disk_usage = lambda p: type("U", (), {"free": 1})()
    try:
        prog = gw.Progress()
        check("refuses when the disk is too small",
              store.download_all(prog, 2, threading.Event()) is False)
        check("disk refusal is reported to the screen",
              "disk space" in (prog.snapshot()["error"] or ""),
              str(prog.snapshot()["error"]))
    finally:
        gw.shutil.disk_usage = real

    # A chunk that cannot be fetched is reported, not silently skipped.
    class BadHttp:
        def get(self, url, tries=4): raise OSError("boom")
    prog = gw.Progress()
    check("failed chunks surface as an error",
          gw.ChunkStore(index, BadHttp()).download_all(prog, 2, threading.Event()) is False
          and "could not be downloaded" in (prog.snapshot()["error"] or ""),
          str(prog.snapshot()["error"]))


def test_watchdog():
    """Stop when the last tab goes, and not before."""
    class FakeHttpd:
        def __init__(self): self.stopped = threading.Event()
        def shutdown(self): self.stopped.set()

    def watchdog(grace=0.4):
        h = FakeHttpd()
        w = gw.Watchdog(h)
        w.GRACE, w.IDLE = grace, 5.0
        threading.Thread(target=w.run, daemon=True).start()
        return h, w

    h, w = watchdog()
    check("idle before anything connects", not h.stopped.wait(1.0))

    w.ping("tab-a")
    check("stays up while a tab pings", not h.stopped.wait(1.0))

    w.ping("tab-a", leaving=True)
    check("stops after the only tab leaves", h.stopped.wait(2.0))

    # Two tabs: losing one must not stop it.
    h, w = watchdog()
    w.ping("a"); w.ping("b")
    w.ping("a", leaving=True)
    for _ in range(6):
        time.sleep(0.1)
        w.ping("b")
    check("survives one of two tabs leaving", not h.stopped.is_set())
    w.ping("b", leaving=True)
    check("stops when the second tab leaves", h.stopped.wait(2.0))

    # The regression this was written for: a beacon fired by the interval can
    # land after the same tab's goodbye, because sendBeacon has no ordering.
    # Identified by tab, that stray must not look like "still here".
    h, w = watchdog()
    w.ping("a")
    w.ping("a", leaving=True)
    w.ping("a")                      # the stray, arriving late
    check("a stray ping after goodbye does not cancel the stop", h.stopped.wait(2.0))

    # A reload is the same shape but a different tab id, and must cancel it.
    h, w = watchdog(grace=1.0)
    w.ping("old")
    w.ping("old", leaving=True)
    time.sleep(0.2)
    for _ in range(12):              # the reloaded page, under a new id
        time.sleep(0.1)
        w.ping("new")
    check("a reload keeps the server alive", not h.stopped.is_set())

    # A tab that dies without a goodbye ages out rather than pinning us open.
    h, w = watchdog(grace=0.4)
    w.IDLE = 0.5
    w.ping("crashed")
    check("a silent tab eventually times out", h.stopped.wait(3.0))


def main():
    import tempfile
    test_framing()
    test_allowlists()
    test_dns_parse()
    test_manifest()
    test_watchdog()
    with tempfile.TemporaryDirectory() as td:
        test_server(Path(td))
        test_lazy_fetch(Path(td) / "lazy")
        test_boot_recording(Path(td) / "boot")
        test_download_all(Path(td) / "image")
    print()
    if FAILED:
        print("%d FAILED: %s" % (len(FAILED), ", ".join(FAILED)))
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
