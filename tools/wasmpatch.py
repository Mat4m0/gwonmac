#!/usr/bin/env python3
"""Grow the indirect function table so every function is reachable."""

import json
import struct
import sys
from collections import defaultdict


def uleb(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def sleb(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        if (v == 0 and not b & 0x40) or (v == -1 and b & 0x40):
            out.append(b)
            return bytes(out)
        out.append(b | 0x80)


def read_uleb(d, i):
    r = s = 0
    while True:
        b = d[i]; i += 1
        r |= (b & 0x7F) << s; s += 7
        if not b & 0x80:
            return r, i


def split_sections(d):
    """-> [(section_id, payload_bytes)] in file order."""
    assert d[:8] == b'\0asm\x01\0\0\0', 'bad wasm header'
    out = []
    p = 8
    while p < len(d):
        sid = d[p]; p += 1
        ln, p = read_uleb(d, p)
        out.append((sid, d[p:p + ln]))
        p += ln
    return out


def parse_table(payload):
    """-> (elemtype, flags, min, max)"""
    n, q = read_uleb(payload, 0)
    assert n == 1, f'expected exactly 1 table, got {n}'
    et = payload[q]; q += 1
    flags = payload[q]; q += 1
    mn, q = read_uleb(payload, q)
    mx = None
    if flags:
        mx, q = read_uleb(payload, q)
    return et, flags, mn, mx


def parse_elem(payload):
    """-> (segment_count, [(base, [funcidx])])"""
    n, q = read_uleb(payload, 0)
    segs = []
    for _ in range(n):
        flags, q = read_uleb(payload, q)
        assert flags == 0, f'unsupported elem flags {flags}'
        assert payload[q] == 0x41, 'expected i32.const offset'
        q += 1
        base, q = read_uleb(payload, q)
        assert payload[q] == 0x0B, 'expected end opcode'
        q += 1
        cnt, q = read_uleb(payload, q)
        idxs = []
        for _ in range(cnt):
            v, q = read_uleb(payload, q)
            idxs.append(v)
        segs.append((base, idxs))
    return n, segs


def count_functions(secs):
    """(num_func_imports, num_defined_functions)"""
    imports = 0
    for sid, payload in secs:
        if sid == 2:
            n, q = read_uleb(payload, 0)
            for _ in range(n):
                l, q = read_uleb(payload, q); q += l
                l, q = read_uleb(payload, q); q += l
                kind = payload[q]; q += 1
                if kind == 0:
                    imports += 1
                    _, q = read_uleb(payload, q)
                elif kind == 1:
                    q += 1
                    fl = payload[q]; q += 1
                    _, q = read_uleb(payload, q)
                    if fl:
                        _, q = read_uleb(payload, q)
                elif kind == 2:
                    fl = payload[q]; q += 1
                    _, q = read_uleb(payload, q)
                    if fl:
                        _, q = read_uleb(payload, q)
                elif kind == 3:
                    q += 2
        elif sid == 3:
            defined, _ = read_uleb(payload, 0)
    return imports, defined


def patch(src, dst, mapping_path=None, table_headroom=0):
    d = open(src, 'rb').read()
    secs = split_sections(d)
    by_id = {sid: payload for sid, payload in secs}

    n_imports, n_defined = count_functions(secs)
    all_funcs = list(range(n_imports, n_imports + n_defined))

    et, flags, mn, mx = parse_table(by_id[4])
    _, segs = parse_elem(by_id[9])
    existing = {}
    for base, idxs in segs:
        for k, v in enumerate(idxs):
            existing[v] = base + k

    missing = [f for f in all_funcs if f not in existing]
    new_base = mn                       # append at the old table size
    new_size = mn + len(missing)
    # Headroom lets the table still grow at runtime, which a side module
    # needs in order to place its own functions. min == max would pin it.
    new_max = new_size + table_headroom

    print(f'  functions      : {n_defined:,} defined '
          f'(indices {all_funcs[0]}..{all_funcs[-1]})')
    print(f'  table before   : min={mn:,} max={mx} '
          f'({len(existing):,} occupied)')
    print(f'  appending      : {len(missing):,} entries at base {new_base:,}')
    print(f'  table after    : min={new_size:,} max={new_max:,}'
          f'{" (growable)" if table_headroom else ""}')

    # -- rebuild table section --------------------------------------------
    new_table = uleb(1) + bytes([et, 0x01]) + uleb(new_size) + uleb(new_max)

    # -- rebuild elem section ---------------------------------------------
    body = bytearray()
    body += uleb(len(segs) + 1)
    for base, idxs in segs:
        body += uleb(0) + b'\x41' + sleb(base) + b'\x0b'
        body += uleb(len(idxs))
        for v in idxs:
            body += uleb(v)
    body += uleb(0) + b'\x41' + sleb(new_base) + b'\x0b'
    body += uleb(len(missing))
    for v in missing:
        body += uleb(v)
    new_elem = bytes(body)

    # -- reassemble --------------------------------------------------------
    out = bytearray(d[:8])
    for sid, payload in secs:
        if sid == 4:
            payload = new_table
        elif sid == 9:
            payload = new_elem
        out.append(sid)
        out += uleb(len(payload))
        out += payload

    open(dst, 'wb').write(out)
    print(f'  size           : {len(d):,} -> {len(out):,} bytes '
          f'({len(out) - len(d):+,})')

    if mapping_path:
        table = dict(existing)
        for k, v in enumerate(missing):
            table[v] = new_base + k
        json.dump({'tableSize': new_size,
                   'added': len(missing),
                   'slots': {str(k): v for k, v in sorted(table.items())}},
                  open(mapping_path, 'w'))
        print(f'  slot map       : {mapping_path} ({len(table):,} entries)')
    return new_size, len(missing)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else \
        '/path/to/gw_in_browser/dist/Gw.jspi.wasm'
    dst = sys.argv[2] if len(sys.argv) > 2 else \
        'path/to/Gw.jspi.patched.wasm'
    import os
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    print(f'{src}\n  -> {dst}')
    patch(src, dst, os.path.join(os.path.dirname(dst), "slots.json"), table_headroom=8192)


if __name__ == '__main__':
    main()
