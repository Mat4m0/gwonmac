#!/usr/bin/env python3
"""Assert the repo contains nothing it should not publish.

Nothing ArenaNet-derived belongs in this repo: not binaries, not
credentials, and not manifest metadata. The scripts reproduce all of it from a
user's own copy of the client.

This exists because a directory-shaped mistake slipped past a pattern-shaped
.gitignore -- dist/snapshot-chunks.json, 16k content hashes, matched none of
the file patterns and was committed. Checking by hand worked until the day it
was not run. So it is a test.

  python3 tests/test_no_leaks.py
"""

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Paths that must never be tracked, by pattern.
FORBIDDEN = [
    (r"\.key$", "credential"),
    (r"\.apk$", "client binary"),
    (r"\.wasm$", "game binary"),
    (r"^Gw\.js$|/Gw\.js$", "game glue"),
    (r"^Gw\.jspi\.js$|/Gw\.jspi\.js$", "game glue"),
    # Match the artifacts, not the word: getsnapshot.py is ours and belongs
    # here. A guard that fires on legitimate files gets ignored, which is worse
    # than not having one.
    (r"(^|/)Gw\.snapshot$", "the snapshot image"),
    (r"(^|/)snapshot-chunks\.json$", "the snapshot chunk index"),
    (r"^dist/", "build output"),
    (r"^gwpatch-cache/", "chunk cache"),
    (r"^manifest\.json$|/manifest\.json$", "ArenaNet manifest"),
    (r"^version\.json$|/version\.json$", "ArenaNet build metadata"),
    (r"^node_modules/", "dependencies"),
]

# Content that must never appear in any tracked file.
SECRETS = [
    (r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}",
     "a UUID -- the access key is UUID-shaped"),
    (r"\b[0-9a-f]{64}\b", "a sha256 -- chunk hashes are ArenaNet metadata"),
]

# Known-good strings that match the patterns above but are not secrets.
ALLOWED = {
    # RFC 6455 section 1.3: the fixed GUID every WebSocket handshake concatenates.
    "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    # ArenaNet's client access key, hardcoded in gw.py so the file runs with
    # nothing to configure -- it ships in the public app bundle and identifies
    # the client, not a user. See CLAUDE.md, "What is committed that arguably
    # should not be". This is NOT a general licence to commit credentials: the
    # one key is exempted by value, so anything else UUID-shaped still fails.
    "2043FE79-F32D-4FD7-8C27-0D47231C4F03",
}

results = []


def check(name, cond, extra=""):
    results.append(cond)
    print(("  PASS  " if cond else "  FAIL  ") + name + ("" if cond else "  <- " + str(extra)))


def tracked():
    out = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True)
    return [p for p in out.stdout.splitlines() if p]


def main():
    files = tracked()
    check("git ls-files returned something", bool(files), "not a git repo?")

    for pattern, why in FORBIDDEN:
        hits = [f for f in files if re.search(pattern, f, re.I)]
        check("no tracked %s (/%s/)" % (why, pattern), not hits, hits)

    # Scan contents. Skip this file, which necessarily contains the patterns.
    for pattern, why in SECRETS:
        hits = []
        for f in files:
            if f == "tests/test_no_leaks.py":
                continue
            p = REPO / f
            try:
                text = p.read_text(errors="ignore")
            except OSError:
                continue
            for m in re.finditer(pattern, text):
                if m.group(0).upper() in ALLOWED:
                    continue
                hits.append("%s: %s..." % (f, m.group(0)[:12]))
                break
        check("no %s in tracked content" % why, not hits, hits)

    failed = results.count(False)
    print("\n%d failure(s)" % failed)
    if failed:
        print("\nSomething publishable-by-accident is tracked. Remove it with\n"
              "  git rm --cached <path>\nand add it to .gitignore.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
