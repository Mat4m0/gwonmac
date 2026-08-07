#!/usr/bin/env python3
"""The client-to-server packet builders, keyed by the opcode each one emits.

    python3 tools/packet_builders.py dist/Gw.jspi.wasm            # the table
    python3 tools/packet_builders.py dist/Gw.jspi.wasm 30 31 21   # those opcodes

## Why the opcode and not the function index

Every message the client sends goes through one sender. A builder puts the
opcode at the head of a stack buffer, copies the caller's arguments after it,
reads the connection from a global, and hands both to that sender:

    <buffer> = [opcode, arg0, arg1, ...]
    call #connection()                      -- a three-instruction global read
    call #send(connection, byteLength, buffer)

The opcode is the wire protocol. It is the same value in every build, because
the server is on the other end of it. **Function indices are not**: GWCAjs
records cluster-local deltas of -2/-6/-7/-9 between adjacent builds, and this
repository's own hand-written list of eight was off by exactly three against
the build it claimed to describe -- an error nothing could detect, because a
bare index carries no way to check itself.

So the certified value is the opcode, and the index is *recovered* per build by
finding the sole builder that emits it. Arity and payload size come back with
it and are checked against what the caller expects, which is what makes the
recovery fail closed rather than silently address the wrong function.

The semantic names come from GWCAjs's `Evidence/internal-calls.json`, which
carries Ghidra-decompiled ArenaNet symbols and its own live verification. This
script does not import that file; it re-derives the shape from our own module
so the two are independent and can be compared.
"""

import sys

from wasmscan import DecodeError, WasmModule, uleb

# Every width a builder might use to write the opcode into its buffer. All the
# ones seen so far use i32.store, but a one-byte opcode is a legal encoding and
# missing it would drop that message from the table silently.
STORE_OPS = (0x36, 0x37, 0x3A, 0x3B)


def function_types(m):
    """(params, results) per function index, from the type and function sections."""
    types = []
    off, _ = m.secs[1][0]
    count, q = uleb(m.d, off)
    for _ in range(count):
        q += 1                                       # 0x60
        n, q = uleb(m.d, q); params = list(m.d[q:q + n]); q += n
        n, q = uleb(m.d, q); results = list(m.d[q:q + n]); q += n
        types.append((params, results))
    order = []
    off, _ = m.secs[3][0]
    count, q = uleb(m.d, off)
    for _ in range(count):
        t, q = uleb(m.d, q)
        order.append(t)
    return {m.num_func_imports + i: types[t] for i, t in enumerate(order)}


def find_pair(m, bodies):
    """The (connection, sender) pair, from the builders themselves.

    Not "the most-called (i32,i32,i32)->void function" -- that is `memcpy` and
    its neighbours, and picking one of those produced a plausible, wrong table
    on the first attempt. Instead: every builder ends in exactly two calls, a
    `()->i32` connection read followed by a `(i32,i32,i32)->void` send.
    Counting those ordered pairs over the whole module makes the real one the
    overwhelming winner, and the runner-up count is reported so a thin margin
    is visible rather than assumed.
    """
    sigs = function_types(m)
    pairs = {}
    for idx, ops in bodies.items():
        calls = [v for _, op, v in ops if op == 0x10]
        if len(calls) != 2:
            continue
        first, second = calls
        if sigs.get(first) != ([], [0x7F]):
            continue
        if sigs.get(second) != ([0x7F, 0x7F, 0x7F], []):
            continue
        pairs[(first, second)] = pairs.get((first, second), 0) + 1
    if not pairs:
        raise SystemExit("no connection/sender pair found -- is this the game module?")
    ranked = sorted(pairs.items(), key=lambda kv: -kv[1])
    (connection, sender), count = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0
    return connection, sender, count, runner_up


def builders(m):
    """opcode -> record, for every packet builder in the module."""
    bodies = {}
    for start, end, idx in m.funcs:
        try:
            bodies[idx] = list(m.decode_body(start, end))
        except DecodeError:
            continue                                  # one bad body is not fatal
    sigs = function_types(m)
    connection, sender, count, runner_up = find_pair(m, bodies)
    lengths = {idx: end - start for start, end, idx in m.funcs}

    found = {}
    for idx, ops in bodies.items():
        # Exactly this pair, in this order: anything else is a function that
        # happens to send, not a builder for one message.
        if [v for _, op, v in ops if op == 0x10] != [connection, sender]:
            continue
        at = next(i for i, (_, op, v) in enumerate(ops) if op == 0x10 and v == sender)
        # `call connection; i32.const SIZE; <buffer>; call sender`. Taking the
        # last constant before the send instead would pick up the `i32.const N;
        # i32.add` that computes the buffer pointer.
        size = next((v for _, op, v in ops[:at][::-1] if op == 0x41), None)
        conn_at = next(i for i, (_, op, v) in enumerate(ops) if op == 0x10 and v == connection)
        size = next((v for _, op, v in ops[conn_at + 1:at] if op == 0x41), size)
        # The opcode is the first constant written straight into the buffer.
        opcode = next((ops[i][2] for i in range(len(ops) - 1)
                       if ops[i][1] == 0x41 and ops[i + 1][1] in STORE_OPS), None)
        if opcode is None:
            continue
        record = {
            "opcode": opcode,
            "function": idx,
            "params": len(sigs[idx][0]),
            "payload": size,
            "bytes": lengths[idx],
            "connection": connection,
            "sender": sender,
            "evidence": (count, runner_up),
        }
        # One builder per opcode is the invariant that makes recovery sound.
        # A duplicate means the shape matched something that is not a builder,
        # and it is reported rather than silently resolved.
        found.setdefault(opcode, []).append(record)
    return found


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__.strip().splitlines()[2].strip())
    m = WasmModule(sys.argv[1])
    found = builders(m)
    wanted = {int(a, 0) for a in sys.argv[2:]}
    ambiguous = {k: v for k, v in found.items() if len(v) != 1}

    first = next(iter(found.values()))[0]
    count, runner_up = first["evidence"]
    print(f"connection #{first['connection']} -> sender #{first['sender']} "
          f"({count} builders; next candidate pair {runner_up}), "
          f"{len(found)} opcodes")
    if ambiguous:
        print(f"AMBIGUOUS: {sorted(ambiguous)} -- recovery is unsound for these")
    print(f"\n{'opcode':>6} {'function':>9} {'params':>6} {'payload':>8} {'body':>6}")
    for opcode in sorted(found):
        if wanted and opcode not in wanted:
            continue
        for r in found[opcode]:
            print(f"{r['opcode']:>6} {r['function']:>9} {r['params']:>6} "
                  f"{str(r['payload']):>8} {r['bytes']:>5}B")


if __name__ == "__main__":
    main()
