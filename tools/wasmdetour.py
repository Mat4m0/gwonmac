#!/usr/bin/env python3
"""Static detour pass: the wasm replacement for MinHook."""

import json
import os
import sys
from collections import OrderedDict


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
    assert d[:8] == b'\0asm\x01\0\0\0', 'bad wasm header'
    out = []
    p = 8
    while p < len(d):
        sid = d[p]; p += 1
        ln, p = read_uleb(d, p)
        out.append([sid, d[p:p + ln]])
        p += ln
    return out


def sec(sid, body):
    return bytes([sid]) + uleb(len(body)) + body


def name(s):
    b = s.encode()
    return uleb(len(b)) + b


VT = {0x7F: 'i32', 0x7E: 'i64', 0x7D: 'f32', 0x7C: 'f64'}


def parse_types(payload):
    n, q = read_uleb(payload, 0)
    out = []
    for _ in range(n):
        assert payload[q] == 0x60
        q += 1
        np, q = read_uleb(payload, q)
        params = [payload[q + i] for i in range(np)]
        q += np
        nr, q = read_uleb(payload, q)
        results = [payload[q + i] for i in range(nr)]
        q += nr
        out.append((params, results))
    return out


def count_func_imports(payload):
    n, q = read_uleb(payload, 0)
    c = 0
    for _ in range(n):
        l, q = read_uleb(payload, q); q += l
        l, q = read_uleb(payload, q); q += l
        kind = payload[q]; q += 1
        if kind == 0:
            c += 1
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
    return c


def parse_funcsec(payload):
    n, q = read_uleb(payload, 0)
    out = []
    for _ in range(n):
        t, q = read_uleb(payload, q)
        out.append(t)
    return out


def parse_code(payload):
    """-> [body_bytes] (each includes the locals declaration)."""
    n, q = read_uleb(payload, 0)
    out = []
    for _ in range(n):
        size, q = read_uleb(payload, q)
        out.append(payload[q:q + size])
        q += size
    return out


def parse_globals(payload):
    """-> (count, raw_bytes_of_entries)"""
    n, q = read_uleb(payload, 0)
    return n, payload[q:]


def parse_exports(payload):
    n, q = read_uleb(payload, 0)
    return n, payload[q:]


def dispatcher_shared(nparams, typeidx, orig_func_idx, global_idx, func_index):
    """Dispatcher reading a shared table in linear memory.

        base = global(g)                 ; 0 => hooks globally off
        slot = mem[base + funcindex*4]   ; 0 => this function not hooked
        slot ? call_indirect(slot)(args) : F_orig(args)

    One global for the whole module instead of one per function, so GWCA's
    Hooker can install a hook with a plain 32-bit store and no JS round trip.
    That keeps Hooker.cpp pure C++ and its shape close to the MinHook version.
    """
    scratch = nparams                                # local after the params
    args = b''.join(b'\x20' + uleb(i) for i in range(nparams))
    c = bytearray()
    c += uleb(1) + uleb(1) + b'\x7f'                 # one i32 local
    # hooks globally disabled?
    c += b'\x23' + uleb(global_idx) + b'\x45'
    c += b'\x04\x40' + args + b'\x10' + uleb(orig_func_idx) + b'\x0f\x0b'
    # this function hooked?
    c += b'\x23' + uleb(global_idx)
    c += b'\x41' + sleb(func_index * 4) + b'\x6a'   # + funcindex*4
    c += b'\x28' + uleb(2) + uleb(0)                # i32.load
    c += b'\x22' + uleb(scratch) + b'\x45'          # local.tee scratch ; eqz
    c += b'\x04\x40' + args + b'\x10' + uleb(orig_func_idx) + b'\x0f\x0b'
    # hooked: call the detour slot
    c += args + b'\x20' + uleb(scratch)
    c += b'\x11' + uleb(typeidx) + uleb(0)
    c += b'\x0b'
    return bytes(c)


def dispatcher(nparams, typeidx, orig_func_idx, global_idx, has_result):
    """Body for the replaced function. Params are locals 0..nparams-1."""
    c = bytearray()
    c += uleb(0)                                     # no extra locals
    # if (g == 0) -> tail-call the relocated original
    c += b'\x23' + uleb(global_idx)                  # global.get g
    c += b'\x45'                                     # i32.eqz
    c += b'\x04\x40'                                 # if (void)
    for i in range(nparams):
        c += b'\x20' + uleb(i)                       # local.get i
    c += b'\x10' + uleb(orig_func_idx)               # call F_orig
    c += b'\x0f'                                     # return
    c += b'\x0b'                                     # end if
    # hooked: call_indirect through the slot in g
    for i in range(nparams):
        c += b'\x20' + uleb(i)                       # local.get i
    c += b'\x23' + uleb(global_idx)                  # global.get g  (table slot)
    c += b'\x11' + uleb(typeidx) + uleb(0)           # call_indirect type, table 0
    c += b'\x0b'                                     # end
    return bytes(c)


def patch_shared(src, dst):
    """Dispatch EVERY function via one shared in-memory hook table.

    Deliberately target-agnostic: it hooks all functions uniformly and encodes
    no knowledge of which ones matter. Nothing about GWCA's hook set, scan
    patterns or detours appears anywhere in this pass or its output, so the
    build step can ship without disclosing any of it.

    Also parks every F_orig in the indirect table at a fixed base, so a
    trampoline handed back to GWCA is an ordinary wasm function pointer and
    `SendUIMessage_Ret(...)` compiles to a normal call_indirect.
    """
    d = open(src, 'rb').read()
    secs = split_sections(d)
    by_id = {sid: body for sid, body in secs}

    types = parse_types(by_id[1])
    n_imports = count_func_imports(by_id[2])
    functypes = parse_funcsec(by_id[3])
    bodies = parse_code(by_id[10])
    n_globals, glob_bytes = parse_globals(by_id[6])
    n_exports, exp_bytes = parse_exports(by_id[7])
    n_defined = len(bodies)

    # table: originals are appended after everything already there
    n, q = read_uleb(by_id[4], 0)
    et = by_id[4][q]; q += 1
    fl = by_id[4][q]; q += 1
    tbl_min, q = read_uleb(by_id[4], q)
    tbl_max = None
    if fl:
        tbl_max, q = read_uleb(by_id[4], q)
    orig_slot_base = tbl_min
    new_tbl_size = tbl_min + n_defined
    new_tbl_max = new_tbl_size + 8192

    gidx = n_globals                       # the single hook-table-base global
    new_types = list(functypes)
    new_bodies = list(bodies)
    orig_indices = []

    for local in range(n_defined):
        f = n_imports + local
        tidx = functypes[local]
        params, _results = types[tidx]
        orig_idx = n_imports + n_defined + local
        orig_indices.append(orig_idx)
        new_types.append(tidx)
        new_bodies.append(bodies[local])
        new_bodies[local] = dispatcher_shared(len(params), tidx, orig_idx, gidx, f)

    new_funcsec = uleb(len(new_types)) + b''.join(uleb(t) for t in new_types)
    new_codesec = uleb(len(new_bodies)) + b''.join(uleb(len(b)) + b for b in new_bodies)
    # Two globals: the mutable hook-table base, and an immutable record of
    # where this pass parked the originals. Exporting the latter is what lets
    # GWCA read the layout off the binary at runtime instead of compiling
    # against a generated header that can go stale.
    new_globalsec = (uleb(n_globals + 2) + glob_bytes +
                     bytes([0x7F, 0x01]) + b'\x41' + sleb(0) + b'\x0b' +
                     bytes([0x7F, 0x00]) + b'\x41' + sleb(orig_slot_base) + b'\x0b')
    new_exportsec = (uleb(n_exports + 2) + exp_bytes +
                     name('gwca_hook_base') + bytes([0x03]) + uleb(gidx) +
                     name('gwca_orig_slot_base') + bytes([0x03]) + uleb(gidx + 1))
    new_tablesec = uleb(1) + bytes([et, 0x01]) + uleb(new_tbl_size) + uleb(new_tbl_max)
    elem_extra = (uleb(0) + b'\x41' + sleb(orig_slot_base) + b'\x0b' +
                  uleb(len(orig_indices)) + b''.join(uleb(i) for i in orig_indices))
    n_elem, q = read_uleb(by_id[9], 0)
    new_elemsec = uleb(n_elem + 1) + by_id[9][q:] + elem_extra

    out = bytearray(d[:8])
    for sid, body in secs:
        if sid == 3: body = new_funcsec
        elif sid == 4: body = new_tablesec
        elif sid == 6: body = new_globalsec
        elif sid == 7: body = new_exportsec
        elif sid == 9: body = new_elemsec
        elif sid == 10: body = new_codesec
        out += sec(sid, body)
    open(dst, 'wb').write(out)

    build_id = ''
    p = 8
    while p < len(d):
        sid = d[p]; p += 1
        ln, p = read_uleb(d, p)
        if sid == 0:
            nl, q = read_uleb(d, p)
            if d[q:q + nl] == b'build_id':
                q += nl
                bl, q = read_uleb(d, q)
                build_id = d[q:q + bl].hex()
        p += ln

    info = {'mode': 'shared', 'buildId': build_id,
            'origSlotBaseGlobal': 'gwca_orig_slot_base',
            'hookBaseGlobal': 'gwca_hook_base',
            'funcBase': n_imports, 'funcCount': n_defined,
            'origSlotBase': orig_slot_base, 'tableSize': new_tbl_size,
            'hookTableBytes': (n_imports + n_defined) * 4}
    json.dump(info, open(os.path.join(os.path.dirname(dst), 'detour-abi.json'), 'w'), indent=1)
    print(f'  functions dispatched : {n_defined:,}')
    print(f'  globals added        : 1  (gwca_hook_base, idx {gidx})')
    print(f'  originals in table   : slots {orig_slot_base:,}..{orig_slot_base+n_defined-1:,}')
    print(f'  hook table size      : {info["hookTableBytes"]:,} bytes (gwca mallocs this)')
    print(f'  size {len(d):,} -> {len(out):,} ({len(out)-len(d):+,})')
    print(f'  -> {dst}')
    return info


def patch(src, dst, targets):
    d = open(src, 'rb').read()
    secs = split_sections(d)
    by_id = {sid: body for sid, body in secs}

    types = parse_types(by_id[1])
    n_imports = count_func_imports(by_id[2])
    functypes = parse_funcsec(by_id[3])
    bodies = parse_code(by_id[10])
    n_globals, glob_bytes = parse_globals(by_id[6])
    n_exports, exp_bytes = parse_exports(by_id[7])

    assert len(functypes) == len(bodies), 'function/code length mismatch'
    n_defined = len(bodies)
    next_func = n_imports + n_defined
    next_global = n_globals

    new_bodies = list(bodies)
    new_types = list(functypes)
    added_globals = bytearray()
    added_exports = bytearray()
    n_added_exports = 0
    info = OrderedDict()

    for f in targets:
        local = f - n_imports
        if not (0 <= local < n_defined):
            print(f'  #{f}: out of range, skipped')
            continue
        tidx = functypes[local]
        params, results = types[tidx]
        orig_idx = next_func
        gidx = next_global
        next_func += 1
        next_global += 1

        # F_orig gets F's body and type, verbatim
        new_types.append(tidx)
        new_bodies.append(bodies[local])
        # F becomes the dispatcher
        new_bodies[local] = dispatcher(len(params), tidx, orig_idx, gidx,
                                       bool(results))

        added_globals += bytes([0x7F, 0x01]) + b'\x41' + sleb(0) + b'\x0b'
        added_exports += name(f'gwca_hook_{f}') + bytes([0x03]) + uleb(gidx)
        added_exports += name(f'gwca_orig_{f}') + bytes([0x00]) + uleb(orig_idx)
        n_added_exports += 2

        info[str(f)] = {
            'orig': orig_idx, 'global': gidx, 'type': tidx,
            'params': [VT.get(p, '?') for p in params],
            'results': [VT.get(r, '?') for r in results],
            'hookExport': f'gwca_hook_{f}', 'origExport': f'gwca_orig_{f}',
        }
        print(f'  #{f}: ({",".join(VT.get(p,"?") for p in params) or "void"}) -> '
              f'({",".join(VT.get(r,"?") for r in results) or "void"})   '
              f'orig=#{orig_idx} global={gidx}')

    # -- reassemble --------------------------------------------------------
    new_funcsec = uleb(len(new_types)) + b''.join(uleb(t) for t in new_types)
    new_codesec = uleb(len(new_bodies)) + b''.join(
        uleb(len(b)) + b for b in new_bodies)
    new_globalsec = uleb(n_globals + len(info)) + glob_bytes + bytes(added_globals)
    new_exportsec = uleb(n_exports + n_added_exports) + exp_bytes + bytes(added_exports)

    out = bytearray(d[:8])
    for sid, body in secs:
        if sid == 3:
            body = new_funcsec
        elif sid == 6:
            body = new_globalsec
        elif sid == 7:
            body = new_exportsec
        elif sid == 10:
            body = new_codesec
        out += sec(sid, body)

    open(dst, 'wb').write(out)
    print(f'\n  size {len(d):,} -> {len(out):,} ({len(out)-len(d):+,})')
    mapf = os.path.join(os.path.dirname(dst), 'detours.json')
    json.dump(info, open(mapf, 'w'), indent=1)
    print(f'  -> {dst}\n  -> {mapf}')


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 1
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if sys.argv[3] == '--all':
        print(f'{src}\n  dispatching every function (shared hook table):')
        patch_shared(src, dst)
        return 0
    targets = [int(x, 0) for x in sys.argv[3:]]
    print(f'{src}\n  detouring {len(targets)} function(s):')
    patch(src, dst, targets)
    return 0


if __name__ == '__main__':
    sys.exit(main())
