#!/usr/bin/env python3
"""Rebuild a `name` section so tools show names instead of indices."""

import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wasmscan import WasmModule, uleb as read_uleb


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


def wname(s):
    b = s.encode('utf-8')
    return uleb(len(b)) + b


def sanitize(s, maxlen=48):
    s = re.sub(r'[^A-Za-z0-9_]', '_', s)
    s = re.sub(r'_+', '_', s).strip('_')
    return s[:maxlen] or 'x'


def import_names(m):
    """funcidx -> imported field name (these are real symbols)."""
    out = {}
    idx = 0
    off, _ = m.secs[2][0]
    n, q = read_uleb(m.d, off)
    for _ in range(n):
        ml, q = read_uleb(m.d, q); mod = m.d[q:q + ml].decode(); q += ml
        nl, q = read_uleb(m.d, q); nm = m.d[q:q + nl].decode(); q += nl
        kind = m.d[q]; q += 1
        if kind == 0:
            _, q = read_uleb(m.d, q)
            out[idx] = nm
            idx += 1
        elif kind == 1:
            q += 1; fl = m.d[q]; q += 1
            _, q = read_uleb(m.d, q)
            if fl: _, q = read_uleb(m.d, q)
        elif kind == 2:
            fl = m.d[q]; q += 1
            _, q = read_uleb(m.d, q)
            if fl: _, q = read_uleb(m.d, q)
        elif kind == 3:
            q += 2
    return out


def export_names(m):
    out = {}
    off, _ = m.secs[7][0]
    n, q = read_uleb(m.d, off)
    for _ in range(n):
        nl, q = read_uleb(m.d, q); nm = m.d[q:q + nl].decode(); q += nl
        kind = m.d[q]; q += 1
        i, q = read_uleb(m.d, q)
        if kind == 0:
            out[i] = nm
    return out


def data_strings(m):
    """address -> text, for every NUL-delimited printable run in .data."""
    out = {}
    for base, blob in m.segs:
        for mm in re.finditer(rb'[\x20-\x7e]{4,200}', blob):
            s, e = mm.start(), mm.end()
            if s > 0 and blob[s - 1] != 0:
                continue                       # not a string start
            if e < len(blob) and blob[e] != 0:
                continue                       # not NUL-terminated
            out[base + s] = mm.group().decode('ascii', 'replace')
    return out


GHIDRA_SCRIPT = r'''# Import wasm string cross-references into Ghidra.
#
# Ghidra's wasm plugin cannot build these itself: `i32.const 1052749` is just
# an integer, and code and linear memory are separate address spaces, so there
# is nothing to tell Ghidra the constant is a pointer into .data. The xrefs are
# computed externally (gensyms.py) and imported here.
#
# Attaches to functions by NAME, which works because the companion
# Gw.named.wasm names every function -- so this does not depend on how the
# plugin lays out memory.
#
# Usage: Ghidra Script Manager -> run this -> pick string_xrefs.csv
#@category Wasm

import csv
from ghidra.program.model.listing import CodeUnit

f = askFile("Select string_xrefs.csv", "Open")
by_func = {}
with open(f.getAbsolutePath()) as fh:
    for row in csv.DictReader(fh):
        by_func.setdefault(row["func_name"], []).append((row["addr"], row["text"]))

fm = currentProgram.getFunctionManager()
byname = {}
for fn in fm.getFunctions(True):
    byname.setdefault(fn.getName(), []).append(fn)

hit = miss = 0
for name, refs in by_func.items():
    fns = byname.get(name)
    if not fns:
        miss += 1
        continue
    for fn in fns:
        lines = ["strings referenced (%d):" % len(refs)]
        for addr, text in refs[:40]:
            lines.append("  %s  %s" % (addr, text))
        if len(refs) > 40:
            lines.append("  ... %d more" % (len(refs) - 40))
        fn.setComment("\n".join(lines))
        for addr, text in refs:
            createBookmark(fn.getEntryPoint(), "wasm-string", text[:80])
        hit += 1

print("annotated %d functions, %d names not found" % (hit, miss))
print("Search: Bookmarks -> filter 'wasm-string', or Search Program Text for the comment")
'''


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else \
        '/path/to/gw_in_browser/dist/Gw.jspi.wasm'
    outdir = sys.argv[2] if len(sys.argv) > 2 else \
        'path/to/GWCA-wasm/build'
    os.makedirs(outdir, exist_ok=True)

    m = WasmModule(src)
    m.build_ref_index()
    imports, exports = import_names(m), export_names(m)
    strings = data_strings(m)

    # which source file(s) and assert strings does each function reference?
    src_of = defaultdict(Counter)
    asserts = defaultdict(list)
    for addr, funcs in m._ref_index.items():
        text = strings.get(addr)
        if not text:
            continue
        is_path = text.endswith(('.cpp', '.h'))
        for f in funcs:
            if is_path:
                src_of[f][text.rsplit('/', 1)[-1]] += 1
            elif 4 <= len(text) <= 90:
                asserts[f].append(text)

    names, source = {}, 0,
    names = {}
    stat = Counter()
    for f in list(imports) + [fi for _, _, fi in m.funcs]:
        if f in imports:
            names[f] = imports[f]; stat['import'] += 1
        elif f in exports:
            names[f] = exports[f]; stat['export'] += 1
        elif src_of.get(f):
            file = src_of[f].most_common(1)[0][0]
            stem = sanitize(file.rsplit('.', 1)[0])
            names[f] = f'{stem}__{f}'
            stat['by source file'] += 1
        else:
            names[f] = f'func_{f}'          # so every function is addressable
            stat['index only'] += 1

    # -- graft the name section on -----------------------------------------
    body = bytearray()
    for f in sorted(names):
        body += uleb(f) + wname(names[f])
    namesub = bytes([1]) + uleb(len(uleb(len(names)) + bytes(body))) + \
        uleb(len(names)) + bytes(body)
    modsub = bytes([0]) + uleb(len(wname('Gw'))) + wname('Gw')
    payload = wname('name') + modsub + namesub
    section = bytes([0]) + uleb(len(payload)) + payload

    out_wasm = os.path.join(outdir, 'Gw.named.wasm')
    with open(out_wasm, 'wb') as fh:
        fh.write(m.d + section)

    # -- companion CSV for everything too long to be a symbol --------------
    out_csv = os.path.join(outdir, 'symbols.csv')
    with open(out_csv, 'w', encoding='utf-8') as fh:
        fh.write('func,name,source,table_slot,asserts\n')
        for _, _, f in m.funcs:
            a = ' | '.join(asserts.get(f, [])[:3]).replace('"', "'")
            slot = m.table.get(f, '')
            files = ';'.join(k for k, _ in src_of.get(f, Counter()).most_common(2))
            fh.write(f'{f},"{names.get(f, "")}","{files}",{slot},"{a}"\n')

    # -- string xrefs: what Ghidra cannot derive on its own ---------------
    out_xref = os.path.join(outdir, 'string_xrefs.csv')
    nx = 0
    with open(out_xref, 'w', encoding='utf-8') as fh:
        fh.write('func,func_name,addr,text\n')
        for addr, funcs in sorted(m._ref_index.items()):
            text = strings.get(addr)
            if not text:
                continue
            t = text.replace('"', "'").replace('\n', ' ')[:160]
            for f in sorted(funcs):
                fh.write(f'{f},"{names.get(f, "")}",0x{addr:08x},"{t}"\n')
                nx += 1

    out_script = os.path.join(outdir, 'ghidra_import_strings.py')
    with open(out_script, 'w', encoding='utf-8') as fh:
        fh.write(GHIDRA_SCRIPT)

    print(f'{src}')
    for k, v in stat.most_common():
        print(f'  {k:<16} {v:,}')
    print(f'  named total      {len(names):,} / {len(m.funcs) + len(imports):,}'
          f'  ({100 * len(names) // (len(m.funcs) + len(imports))}%)')
    print(f'  -> {out_wasm}  (+{len(section):,} bytes)')
    print(f'  -> {out_csv}')


if __name__ == '__main__':
    main()
