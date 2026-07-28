#!/usr/bin/env python3
"""Decode Gw.wasm, resolve anchors, and report candidate functions."""

import argparse
import hashlib
import json
import sys
from collections import defaultdict

# ---------------------------------------------------------------- LEB128

def uleb(d, i):
    r = s = 0
    while True:
        b = d[i]; i += 1
        r |= (b & 0x7F) << s; s += 7
        if not b & 0x80:
            return r, i


def sleb(d, i):
    r = s = 0
    while True:
        b = d[i]; i += 1
        r |= (b & 0x7F) << s; s += 7
        if not b & 0x80:
            if s < 64 and b & 0x40:
                r |= -(1 << s)
            return r, i


# ------------------------------------------------------- immediate specs
# opcode -> how to skip/read its immediates

NONE, BLOCKTYPE, U32, MEMARG, I32, I64, F32, F64 = range(8)
BRTABLE, VALTYPE, SELECTVEC, CALL_INDIRECT = range(8, 12)

OPS = {}
for _o in (0x00, 0x01, 0x05, 0x0B, 0x0F, 0x1A, 0x1B, 0xD1):
    OPS[_o] = NONE
for _o in (0x02, 0x03, 0x04):
    OPS[_o] = BLOCKTYPE
for _o in (0x0C, 0x0D, 0x10, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26,
           0x3F, 0x40, 0xD2):
    OPS[_o] = U32
for _o in range(0x28, 0x3F):                 # loads 0x28-0x35, stores 0x36-0x3E
    OPS[_o] = MEMARG
for _o in range(0x45, 0xC5):                 # numeric incl. sign-ext 0xC0-0xC4
    OPS[_o] = NONE
OPS[0x0E] = BRTABLE
OPS[0x11] = CALL_INDIRECT
OPS[0x1C] = SELECTVEC
OPS[0x41] = I32
OPS[0x42] = I64
OPS[0x43] = F32
OPS[0x44] = F64
OPS[0xD0] = VALTYPE

# 0xFC prefixed -> number of u32 immediates
FC_OPS = {**{i: 0 for i in range(0, 8)},     # nontrapping fp->int
          8: 2, 9: 1, 10: 2, 11: 1,          # memory.init/data.drop/copy/fill
          12: 2, 13: 1, 14: 2, 15: 1, 16: 1, 17: 1}   # table ops


class DecodeError(Exception):
    pass


# ----------------------------------------------------------------- module

class WasmModule:
    def __init__(self, path):
        self.path = path
        self.d = d = open(path, 'rb').read()
        if d[:4] != b'\0asm':
            raise DecodeError('not a wasm module')
        self.secs = defaultdict(list)
        p = 8
        while p < len(d):
            sid = d[p]; p += 1
            ln, p = uleb(d, p)
            self.secs[sid].append((p, ln))
            p += ln
        self._data_segments()
        self._types()
        self._func_imports()
        self._defined_function_types()
        self._code_ranges()
        self._ref_index = None
        self._table = None
        self._call_graph = None

    # -- sections ---------------------------------------------------------

    def _types(self):
        """Decode the function types needed to describe candidate functions."""
        self.types = []
        if 1 not in self.secs:
            return
        off, _ = self.secs[1][0]
        n, q = uleb(self.d, off)
        names = {
            0x7F: 'i32', 0x7E: 'i64', 0x7D: 'f32', 0x7C: 'f64',
            0x7B: 'v128', 0x70: 'funcref', 0x6F: 'externref',
        }
        for _ in range(n):
            if self.d[q] != 0x60:
                raise DecodeError(f'unsupported type form 0x{self.d[q]:02x}')
            q += 1
            pc, q = uleb(self.d, q)
            params = []
            for _ in range(pc):
                value = self.d[q]; q += 1
                params.append(names.get(value, f'0x{value:02x}'))
            rc, q = uleb(self.d, q)
            results = []
            for _ in range(rc):
                value = self.d[q]; q += 1
                results.append(names.get(value, f'0x{value:02x}'))
            self.types.append((params, results))

    def _data_segments(self):
        self.segs = []
        if 11 not in self.secs:
            return
        off, _ = self.secs[11][0]
        n, q = uleb(self.d, off)
        for _ in range(n):
            flags, q = uleb(self.d, q)
            if flags != 0:
                raise DecodeError(f'unsupported data segment flags {flags}')
            q += 1                                   # i32.const
            base, q = uleb(self.d, q)
            q += 1                                   # end
            size, q = uleb(self.d, q)
            self.segs.append((base, self.d[q:q + size]))
            q += size
        self.data_lo = self.segs[0][0]
        self.data_hi = self.segs[-1][0] + len(self.segs[-1][1])

    def _func_imports(self):
        self.num_func_imports = 0
        self.import_func_types = []
        if 2 not in self.secs:
            return
        off, _ = self.secs[2][0]
        n, q = uleb(self.d, off)
        for _ in range(n):
            ml, q = uleb(self.d, q); q += ml
            nl, q = uleb(self.d, q); q += nl
            kind = self.d[q]; q += 1
            if kind == 0:
                self.num_func_imports += 1
                typeidx, q = uleb(self.d, q)
                self.import_func_types.append(typeidx)
            elif kind == 1:
                q += 1
                fl = self.d[q]; q += 1
                _, q = uleb(self.d, q)
                if fl:
                    _, q = uleb(self.d, q)
            elif kind == 2:
                fl = self.d[q]; q += 1
                _, q = uleb(self.d, q)
                if fl:
                    _, q = uleb(self.d, q)
            elif kind == 3:
                q += 2

    def _defined_function_types(self):
        self.defined_func_types = []
        if 3 not in self.secs:
            return
        off, _ = self.secs[3][0]
        n, q = uleb(self.d, off)
        for _ in range(n):
            typeidx, q = uleb(self.d, q)
            self.defined_func_types.append(typeidx)

    def _code_ranges(self):
        self.funcs = []
        off, _ = self.secs[10][0]
        n, q = uleb(self.d, off)
        for i in range(n):
            size, q = uleb(self.d, q)
            self.funcs.append((q, q + size, self.num_func_imports + i))
            q += size
        self.code_lo = self.funcs[0][0]
        self.code_hi = self.funcs[-1][1]

    @property
    def table(self):
        """funcidx -> table slot, for the one active elem segment."""
        if self._table is None:
            self._table = {}
            if 9 in self.secs:
                off, _ = self.secs[9][0]
                n, q = uleb(self.d, off)
                for _ in range(n):
                    flags, q = uleb(self.d, q)
                    if flags != 0:
                        continue
                    q += 1
                    base, q = uleb(self.d, q)
                    q += 1
                    cnt, q = uleb(self.d, q)
                    for k in range(cnt):
                        v, q = uleb(self.d, q)
                        self._table[v] = base + k
        return self._table

    # -- instruction decoding --------------------------------------------

    def decode_body(self, start, end):
        """Walk one function body, yielding (offset, opcode, value).

        `value` is the decoded operand for i32.const and linear-memory
        instructions, and None otherwise.
        Raises DecodeError on anything unrecognised rather than guessing --
        a silent resync would reintroduce exactly the false positives this
        decoder exists to eliminate.
        """
        d = self.d
        q = start
        nlocals, q = uleb(d, q)
        for _ in range(nlocals):
            _, q = uleb(d, q)                        # count
            q += 1                                   # valtype

        while q < end:
            off = q
            op = d[q]; q += 1

            if op == 0xFC:
                sub, q = uleb(d, q)
                if sub not in FC_OPS:
                    raise DecodeError(f'0xFC {sub} @{off}')
                for _ in range(FC_OPS[sub]):
                    _, q = uleb(d, q)
                yield off, op, None
                continue

            spec = OPS.get(op)
            if spec is None:
                raise DecodeError(f'opcode 0x{op:02x} @{off}')

            val = None
            if spec == NONE:
                pass
            elif spec == BLOCKTYPE:
                # 0x40 empty, a valtype byte, or a positive s33 type index
                if d[q] == 0x40 or d[q] in (0x7F, 0x7E, 0x7D, 0x7C, 0x70, 0x6F):
                    q += 1
                else:
                    _, q = sleb(d, q)
            elif spec == U32:
                val, q = uleb(d, q)
            elif spec == MEMARG:
                align, q = uleb(d, q)
                val, q = uleb(d, q)                  # offset
                if align & 0x40:                     # multi-memory form
                    _, q = uleb(d, q)
            elif spec == I32:
                val, q = sleb(d, q)
            elif spec == I64:
                _, q = sleb(d, q)
            elif spec == F32:
                q += 4
            elif spec == F64:
                q += 8
            elif spec == BRTABLE:
                cnt, q = uleb(d, q)
                for _ in range(cnt + 1):             # targets + default
                    _, q = uleb(d, q)
            elif spec == VALTYPE:
                q += 1
            elif spec == SELECTVEC:
                cnt, q = uleb(d, q)
                q += cnt
            elif spec == CALL_INDIRECT:
                _, q = uleb(d, q)                    # typeidx
                _, q = uleb(d, q)                    # tableidx
            yield off, op, val

        if q != end:
            raise DecodeError(f'body overran: {q} != {end}')

    # -- reference index --------------------------------------------------

    def build_ref_index(self, verbose=False):
        """data address -> {func_index: count}, via full instruction decode."""
        if self._ref_index is not None:
            return self._ref_index
        idx = defaultdict(lambda: defaultdict(int))
        self.decode_failures = []
        for start, end, fidx in self.funcs:
            try:
                for _off, op, val in self.decode_body(start, end):
                    if op == 0x41 and val is not None \
                            and self.data_lo <= val < self.data_hi:
                        idx[val][fidx] += 1
            except (DecodeError, IndexError) as e:
                self.decode_failures.append((fidx, str(e)))
        if verbose and self.decode_failures:
            print(f'  decode failures: {len(self.decode_failures)}',
                  file=sys.stderr)
            for f, e in self.decode_failures[:5]:
                print(f'    #{f}: {e}', file=sys.stderr)
        self._ref_index = idx
        return idx

    def refs_to(self, addr):
        return dict(self.build_ref_index().get(addr, {}))

    # -- candidate reports ------------------------------------------------

    def call_graph(self):
        """Return direct calls for every decoded defined function.

        The graph is cached because both the ordinary candidate report and the
        property-context classifier need the same full-module walk.
        """
        if self._call_graph is not None:
            return self._call_graph
        callees = defaultdict(set)
        callers = defaultdict(set)
        call_sites = defaultdict(list)
        failures = []
        for start, end, caller in self.funcs:
            try:
                for offset, opcode, operand in self.decode_body(start, end):
                    if opcode != 0x10 or operand is None:
                        continue
                    callees[caller].add(operand)
                    callers[operand].add(caller)
                    call_sites[caller].append({
                        'bodyOffset': offset - start,
                        'functionIndex': operand,
                    })
            except (DecodeError, IndexError) as error:
                failures.append({'functionIndex': caller, 'error': str(error)})
        self._call_graph = (callees, callers, call_sites, failures)
        return self._call_graph

    def property_context_report(self, explicit_roots=None):
        """Conservatively classify functions that can reach property context.

        The official client asserts on the literal `s_propContext` when a
        wrapper is entered outside its owning callback. The functions that
        reference that assertion are roots. Every direct or transitive caller
        is context-bound for cross-boundary export purposes.

        `explicit_roots` exists for fixtures and for a future build whose
        assertion text has moved. Production investigations should normally
        use the assertion-derived roots.
        """
        roots = set(explicit_roots or ())
        if not roots:
            roots.update(self.find_use_of_string('s_propContext'))
        callees, callers, _call_sites, _failures = self.call_graph()
        bound = set(roots)
        pending = list(roots)
        while pending:
            callee = pending.pop()
            for caller in callers.get(callee, ()):
                if caller not in bound:
                    bound.add(caller)
                    pending.append(caller)

        defined = {fidx for _start, _end, fidx in self.funcs}

        def frontier(function):
            """First context-free defined callees below a bound wrapper."""
            found = set()
            seen = set()
            pending = [function]
            while pending:
                current = pending.pop()
                if current in seen:
                    continue
                seen.add(current)
                for callee in callees.get(current, ()):
                    if callee not in defined:
                        continue
                    if callee in bound:
                        pending.append(callee)
                    else:
                        found.add(callee)
            return sorted(found)

        return {
            'roots': sorted(roots),
            'bound': bound,
            'frontier': frontier,
        }

    def function_signature(self, fidx):
        """Return the canonical type for an imported or defined function."""
        if fidx < self.num_func_imports:
            typeidx = self.import_func_types[fidx]
        else:
            local = fidx - self.num_func_imports
            if local < 0 or local >= len(self.defined_func_types):
                raise DecodeError(f'function index out of range: {fidx}')
            typeidx = self.defined_func_types[local]
        if typeidx >= len(self.types):
            raise DecodeError(f'type index out of range: {typeidx}')
        params, results = self.types[typeidx]
        return {'typeIndex': typeidx, 'params': params, 'results': results}

    def function_report(self, requested, property_context_roots=None):
        """Bounded static evidence for specific candidate function indices."""
        wanted = set(requested)
        bodies = {
            fidx: (start, end)
            for start, end, fidx in self.funcs
            if fidx in wanted
        }
        missing = sorted(wanted - set(bodies))
        if missing:
            raise DecodeError(
                'requested function is imported or out of range: '
                + ', '.join(str(value) for value in missing)
            )

        callees, callers, call_sites, failures = self.call_graph()
        context = self.property_context_report(property_context_roots)

        functions = []
        for fidx in requested:
            start, end = bodies[fidx]
            functions.append({
                'functionIndex': fidx,
                'definedIndex': fidx - self.num_func_imports,
                'signature': self.function_signature(fidx),
                'body': {
                    'start': start,
                    'end': end,
                    'size': end - start,
                    'sha256': hashlib.sha256(self.d[start:end]).hexdigest(),
                },
                'tableSlot': self.table.get(fidx),
                'directCallers': sorted(callers[fidx]),
                'directCallees': sorted(callees[fidx]),
                'directCalls': call_sites[fidx],
                'propertyContextBound': fidx in context['bound'],
                'contextFreeFrontier': context['frontier'](fidx)
                    if fidx in context['bound'] else [],
            })
        return {
            'module': self.path,
            'functionImports': self.num_func_imports,
            'definedFunctions': len(self.funcs),
            'propertyContext': {
                'roots': context['roots'],
                'boundFunctions': len(context['bound']),
            },
            'functions': functions,
            'decodeFailures': failures,
        }

    # -- string lookup ----------------------------------------------------

    def find_strings(self, s, whole=True):
        """Every linear address where this text exists as a C string.

        Strings are pooled per translation unit, not globally, so the same
        text can sit at several addresses with only some referenced.

        whole=False matches a tail and walks back to the string start; source
        paths are stored with a `../../../../` prefix, so GWCA's
        `\\Code\\Gw\\Ui\\UiRoot.cpp` must be matched that way.
        """
        b = s.encode() if isinstance(s, str) else s
        out = []
        for base, blob in self.segs:
            i = blob.find(b)
            while i >= 0:
                start = i
                if not whole:
                    nul = blob.rfind(b'\0', 0, i)
                    start = nul + 1 if nul >= 0 else 0
                ok = (start == 0 or blob[start - 1] == 0)
                if whole:
                    ok = ok and blob.find(b'\0', start) == i + len(b)
                if ok:
                    out.append(base + start)
                i = blob.find(b, i + 1)
        return out

    @staticmethod
    def normalize_path(p):
        """GWCA's `\\Code\\Gw\\Ui\\UiRoot.cpp` -> `Gw/Ui/UiRoot.cpp`."""
        p = p.replace('\\', '/').lstrip('/')
        return p[5:] if p.startswith('Code/') else p

    def find_use_of_string(self, s, whole=True):
        """GW::Scanner::FindUseOfString -> {func_index: site_count}."""
        total = defaultdict(int)
        for addr in self.find_strings(s, whole=whole):
            for f, c in self.refs_to(addr).items():
                total[f] += c
        return dict(total)


# -------------------------------------------------------------------- cli

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wasm')
    parser.add_argument('queries', nargs='*')
    parser.add_argument(
        '--functions',
        help='comma-separated function indices to report with signatures and calls',
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='emit the --functions report as JSON',
    )
    parser.add_argument(
        '--property-context-roots',
        help=(
            'comma-separated property-context root functions; defaults to '
            'functions referencing the s_propContext assertion'
        ),
    )
    args = parser.parse_args()
    wasm = args.wasm
    m = WasmModule(wasm)
    if args.functions:
        requested = []
        for value in args.functions.split(','):
            try:
                fidx = int(value.strip(), 0)
            except ValueError as error:
                parser.error(f'invalid function index {value!r}: {error}')
            if fidx < 0:
                parser.error(f'function index must be non-negative: {fidx}')
            requested.append(fidx)
        if not requested:
            parser.error('--functions requires at least one index')
        property_context_roots = None
        if args.property_context_roots:
            property_context_roots = []
            for value in args.property_context_roots.split(','):
                try:
                    root = int(value.strip(), 0)
                except ValueError as error:
                    parser.error(
                        f'invalid property-context root {value!r}: {error}'
                    )
                if root < 0:
                    parser.error(
                        f'property-context root must be non-negative: {root}'
                    )
                property_context_roots.append(root)
        report = m.function_report(requested, property_context_roots)
        if args.json:
            print(json.dumps(report, indent=2, sort_keys=True))
            return
        print(json.dumps(report, indent=2, sort_keys=True))
        if not args.queries:
            return
    elif args.json:
        parser.error('--json requires --functions')

    print(f'{wasm}')
    print(f'  func imports : {m.num_func_imports}')
    print(f'  defined funcs: {len(m.funcs)}')
    print(f'  data range   : 0x{m.data_lo:08x}-0x{m.data_hi:08x}')
    print(f'  table entries: {len(m.table)}')
    m.build_ref_index(verbose=True)
    print(f'  decoded ok   : {len(m.funcs) - len(m.decode_failures)}'
          f'/{len(m.funcs)} functions')
    print(f'  data refs    : {len(m._ref_index):,} distinct addresses')

    for q in args.queries:
        hits = m.find_use_of_string(q)
        if not hits:
            hits = m.find_use_of_string(m.normalize_path(q), whole=False)
        print(f'\n{q!r}')
        for f, c in sorted(hits.items(), key=lambda kv: -kv[1])[:10]:
            slot = m.table.get(f)
            where = f'table[{slot}]' if slot is not None else 'not in table'
            print(f'  #{f:<7} sites={c:<5} {where}')


if __name__ == '__main__':
    main()
