#!/usr/bin/env python3
"""Extract the Guild Wars Reforged client's X-Access-Key from an APK.

Run once against a base.apk; the key it writes is what gwpatch.py consumes.
The key ships in the public client bundle -- it identifies the client, it does
not authenticate a user -- but it is still a credential belonging to someone
else's service, so the output file is written 0600 and is worth keeping out of
source control.

  python3 gwkey.py base.apk                # -> access.key
  python3 gwkey.py base.apk -o path/to.key
  python3 gwkey.py base.apk -            # -> stdout
"""

import argparse
import os
import re
import sys
import zipfile

# The bundle embeds it as a customHeaders entry; match the UUID shape so we
# don't pick up an unrelated header of the same name.
PATTERN = re.compile(r'["\']X-Access-Key["\']\s*:\s*["\']([0-9A-Fa-f-]{36})["\']')


def extract(apk):
    with zipfile.ZipFile(apk) as z:
        names = [n for n in z.namelist() if n.endswith(".js")]
        # The client bundle is the overwhelmingly likely home; try it first,
        # then fall back to every other script rather than guessing filenames.
        names.sort(key=lambda n: "Client.astro" not in n)

        found = {}
        for name in names:
            for key in PATTERN.findall(z.read(name).decode("utf-8", "replace")):
                found.setdefault(key, name)

    if not found:
        sys.exit("no X-Access-Key found in %s" % apk)
    if len(found) > 1:
        # Surface rather than silently taking the first: a second key would
        # mean the client talks to more than one service.
        print("warning: %d distinct keys found, using the first:" % len(found),
              file=sys.stderr)
        for key, where in found.items():
            print("  %s  (%s)" % (key, where), file=sys.stderr)

    key, where = next(iter(found.items()))
    return key, where


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("apk", help="path to base.apk")
    ap.add_argument("-o", "--out", default="access.key",
                    help="output file, or - for stdout (default: access.key)")
    args = ap.parse_args()

    key, where = extract(args.apk)
    print("found in %s" % where, file=sys.stderr)

    if args.out == "-":
        print(key)
        return

    with open(args.out, "w") as fh:
        fh.write(key + "\n")
    os.chmod(args.out, 0o600)
    print("wrote %s (mode 600)" % args.out, file=sys.stderr)


if __name__ == "__main__":
    main()
