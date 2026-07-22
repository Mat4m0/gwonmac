#!/bin/bash
# Double-click entry point for macOS. Finder runs .command files in a new
# Terminal window, which is the whole reason this file exists: gw.py on its
# own opens in a text editor when double-clicked, same as any other .py file.
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 is required. Install it from https://www.python.org/downloads/, then run this again."
    read -rp "Press Return to close this window..."
    exit 1
fi

python3 gw.py
read -rp "Press Return to close this window..."
