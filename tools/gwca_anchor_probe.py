#!/usr/bin/env python3
"""Measure how well GWCA assertion anchors survive in a Guild Wars WASM build."""

import ast
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gensyms import data_strings
from wasmscan import WasmModule


ASSERTION = re.compile(
    r"Scanner::FindAssertion\(\s*"
    r'(?P<file>"(?:\\.|[^"\\])*"|nullptr|NULL)\s*,\s*'
    r'(?P<message>"(?:\\.|[^"\\])*"|nullptr|NULL)',
    re.MULTILINE,
)


def c_string(token):
    if token in {"nullptr", "NULL"}:
        return None
    return ast.literal_eval(token)


def normalize_path(value):
    return value.replace("\\", "/").lower()


def assertion_calls(source_root):
    for root, _, files in os.walk(source_root):
        for filename in files:
            if not filename.endswith((".cpp", ".cc", ".cxx")):
                continue
            path = os.path.join(root, filename)
            with open(path, encoding="utf-8", errors="replace") as source:
                text = source.read()
            for match in ASSERTION.finditer(text):
                yield {
                    "source": os.path.relpath(path, source_root),
                    "file": c_string(match.group("file")),
                    "message": c_string(match.group("message")),
                }


def functions_for_path(strings, references, wanted):
    wanted = normalize_path(wanted)
    suffix = wanted.split("/code/", 1)[-1]
    result = set()
    matched = []
    for address, text in strings.items():
        if normalize_path(text).endswith(suffix):
            matched.append(text)
            result.update(references.get(address, ()))
    return result, matched


def functions_for_text(strings, references, wanted):
    result = set()
    matched = []
    for address, text in strings.items():
        if text == wanted:
            matched.append(text)
            result.update(references.get(address, ()))
    return result, matched


def main():
    if len(sys.argv) != 3:
        raise SystemExit(
            f"usage: {os.path.basename(sys.argv[0])} GWCA_SOURCE_ROOT GW_WASM"
        )

    source_root, wasm_path = sys.argv[1:]
    module = WasmModule(wasm_path)
    module.build_ref_index()
    strings = data_strings(module)
    calls = list(assertion_calls(source_root))
    counts = Counter()
    rows = []

    for call in calls:
        file_functions, matched_files = (
            functions_for_path(strings, module._ref_index, call["file"])
            if call["file"]
            else (set(), [])
        )
        message_functions, matched_messages = (
            functions_for_text(strings, module._ref_index, call["message"])
            if call["message"]
            else (set(), [])
        )

        if call["file"] and not matched_files:
            outcome = "missing-file"
            candidates = set()
        elif call["message"] and not matched_messages:
            outcome = "missing-message"
            candidates = set()
        elif call["file"] and call["message"]:
            candidates = file_functions & message_functions
            outcome = (
                "unique"
                if len(candidates) == 1
                else "ambiguous"
                if candidates
                else "split"
            )
        else:
            candidates = file_functions or message_functions
            outcome = "unique" if len(candidates) == 1 else "ambiguous"

        counts[outcome] += 1
        rows.append((call, outcome, sorted(candidates)))

    print(f"WASM: {wasm_path}")
    print(f"GWCA source: {source_root}")
    print(f"assertion calls: {len(calls)}")
    for outcome in (
        "unique",
        "ambiguous",
        "split",
        "missing-file",
        "missing-message",
    ):
        print(f"{outcome:>15}: {counts[outcome]}")

    print("\nUnique anchors:")
    for call, outcome, candidates in rows:
        if outcome != "unique":
            continue
        print(
            f"  #{candidates[0]:<6} "
            f"{call['source']}: {call['file']!r}, {call['message']!r}"
        )

    unresolved = [row for row in rows if row[1] != "unique"]
    if unresolved:
        print("\nUnresolved anchors:")
        for call, outcome, candidates in unresolved:
            detail = f" candidates={candidates}" if candidates else ""
            print(
                f"  {outcome:<15} {call['source']}: "
                f"{call['file']!r}, {call['message']!r}{detail}"
            )


if __name__ == "__main__":
    main()
