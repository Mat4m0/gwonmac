import assert from "node:assert/strict";
import test from "node:test";
import { installGlProgramCache } from "../../src/renderer/gl-program-cache.js";

// The module is imported, not read and evaluated in a synthetic context. Its
// cache lives entirely inside each install call, so a fresh fixture is a fresh
// cache; what it still reaches for ambiently is the page — `gwDiagnostics` to
// count a query and `gwGlRecon` to publish the console helper — so each
// fixture installs its own window and its own listener sink over the last.
const COMPLETION_STATUS = 0x91b1;
const LINK_STATUS = 0x8b82;
const ACTIVE_UNIFORMS = 0x8b86;
const ACTIVE_ATTRIBUTES = 0x8b89;
const ACTIVE_UNIFORM_BLOCKS = 0x8a36;
const VALIDATE_STATUS = 0x8b83;
const DELETE_STATUS = 0x8b80;
const ATTACHED_SHADERS = 0x8b85;
const INFO_LOG_LENGTH = 0x8b84;
const ACTIVE_UNIFORM_MAX_LENGTH = 0x8b87;

const OUT = 64;
const GL_FALSE = 0;
const GL_TRUE = 1;

type GlEnv = {
  glGetProgramiv: (program: number, pname: number, p: number) => void;
  glCreateProgram: () => number;
  glLinkProgram: (program: number) => void;
  glDeleteProgram: (program: number) => void;
};

interface Fixture {
  env: Partial<GlEnv>;
  module: { HEAPU8: Uint8Array };
  words: Int32Array;
  /** Every (program, pname) pair that reached the underlying import. */
  calls: Array<[number, number]>;
  /** What the underlying import writes; change it to detect staleness. */
  answer: { value: number; writes: boolean };
  warnings: string[];
  listeners: Map<string, Array<() => void>>;
  reconOf(): { livePrograms: number; passThrough: Record<string, number> };
  setHeap(bytes: Uint8Array): void;
  recycle(id: number): void;
}

function fixture(options: { omit?: Array<keyof GlEnv> } = {}): Fixture {
  const omit = new Set(options.omit ?? []);
  const module = { HEAPU8: new Uint8Array(new ArrayBuffer(2048)) };
  const calls: Array<[number, number]> = [];
  const answer = { value: GL_TRUE, writes: true };
  const warnings: string[] = [];
  const listeners = new Map<string, Array<() => void>>();
  let nextProgram = 1;
  const queued: number[] = [];

  const full: GlEnv = {
    glGetProgramiv(program, pname, p) {
      calls.push([program, pname]);
      // The generated glue leaves params untouched on its error branches.
      if (!answer.writes) return;
      new Int32Array(module.HEAPU8.buffer)[p >>> 2] = answer.value;
    },
    glCreateProgram: () => queued.shift() ?? nextProgram++,
    glLinkProgram: () => {},
    glDeleteProgram: () => {},
  };
  const env: Partial<GlEnv> = {};
  for (const name of Object.keys(full) as Array<keyof GlEnv>) {
    if (!omit.has(name)) env[name] = full[name] as never;
  }

  const window = {
    gwGlRecon: undefined as
      | (() => { livePrograms: number; passThrough: Record<string, number> })
      | undefined,
    gwDiagnostics: undefined,
    dispatchEvent: () => true,
  };
  Object.assign(globalThis, {
    window,
    addEventListener(name: string, listener: () => void) {
      const bucket = listeners.get(name) ?? [];
      bucket.push(listener);
      listeners.set(name, bucket);
    },
  });
  installGlProgramCache({
    imports: { env },
    module,
    log: (...values: unknown[]) => warnings.push(values.join(" ")),
  });

  return {
    env,
    module,
    get words() {
      return new Int32Array(module.HEAPU8.buffer);
    },
    calls,
    answer,
    warnings,
    listeners,
    reconOf: () => window.gwGlRecon?.() ?? { livePrograms: 0, passThrough: {} },
    setHeap: (bytes) => {
      module.HEAPU8 = bytes;
    },
    recycle: (id: number) => queued.push(id),
  } as Fixture;
}

/** Query through the installed wrapper and return what landed in the heap. */
function query(value: Fixture, program: number, pname: number): number {
  value.env.glGetProgramiv?.(program, pname, OUT);
  return value.words[OUT >>> 2] ?? 0;
}

test("a completed program is answered without another round trip", () => {
  const value = fixture();
  const program = value.env.glCreateProgram!();
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);
  value.answer.value = 0xbad;
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);
  assert.deepEqual(value.calls, [[program, COMPLETION_STATUS]]);
});

test("an incomplete program is never frozen, however often it is polled", () => {
  // The client polls until this flips. Caching false would make it poll a
  // program that never finishes — a hang, not a slow frame.
  const value = fixture();
  const program = value.env.glCreateProgram!();
  value.answer.value = GL_FALSE;
  for (let poll = 0; poll < 5; poll += 1) {
    assert.equal(query(value, program, COMPLETION_STATUS), GL_FALSE);
  }
  assert.equal(value.calls.length, 5);

  // The moment it completes, that is observed and then held.
  value.answer.value = GL_TRUE;
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);
  assert.equal(value.calls.length, 6);
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);
  assert.equal(value.calls.length, 6);
});

test("relinking makes a completed program incomplete again", () => {
  const value = fixture();
  const first = value.env.glCreateProgram!();
  const second = value.env.glCreateProgram!();
  query(value, first, COMPLETION_STATUS);
  query(value, second, COMPLETION_STATUS);
  value.calls.length = 0;

  value.env.glLinkProgram!(first);
  value.answer.value = GL_FALSE;
  assert.equal(query(value, first, COMPLETION_STATUS), GL_FALSE);
  // The other program keeps its completion.
  assert.equal(query(value, second, COMPLETION_STATUS), GL_TRUE);
  assert.deepEqual(value.calls, [[first, COMPLETION_STATUS]]);
});

test("a recycled program name never inherits the deleted program's completion", () => {
  const value = fixture();
  const program = value.env.glCreateProgram!();
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);

  value.env.glDeleteProgram!(program);
  value.recycle(program);
  assert.equal(value.env.glCreateProgram!(), program);

  value.calls.length = 0;
  value.answer.value = GL_FALSE;
  assert.equal(query(value, program, COMPLETION_STATUS), GL_FALSE);
  assert.deepEqual(value.calls, [[program, COMPLETION_STATUS]]);
});

test("a name the host never saw created always reaches the client", () => {
  const value = fixture();
  assert.equal(query(value, 42, COMPLETION_STATUS), GL_TRUE);
  assert.equal(query(value, 42, COMPLETION_STATUS), GL_TRUE);
  assert.equal(value.calls.length, 2);

  // The glue's out-of-range branch writes nothing; recording the out-pointer
  // there would capture whatever happened to be in memory.
  value.words[OUT >>> 2] = 0xdead;
  value.answer.writes = false;
  assert.equal(query(value, 42, COMPLETION_STATUS), 0xdead);
  assert.equal(value.calls.length, 3);
});

test("every pname except completion reaches the client every time", () => {
  for (const pname of [
    // Measured at exactly one query per program, so caching buys nothing.
    LINK_STATUS,
    ACTIVE_UNIFORMS,
    ACTIVE_ATTRIBUTES,
    ACTIVE_UNIFORM_BLOCKS,
    // Unsafe or already memoized by the generated glue.
    VALIDATE_STATUS,
    DELETE_STATUS,
    ATTACHED_SHADERS,
    INFO_LOG_LENGTH,
    ACTIVE_UNIFORM_MAX_LENGTH,
    0x1234,
  ]) {
    const value = fixture();
    const program = value.env.glCreateProgram!();
    const label = `pname 0x${pname.toString(16)}`;
    assert.equal(query(value, program, pname), GL_TRUE, label);
    value.answer.value = 12;
    assert.equal(query(value, program, pname), 12, label);
    assert.equal(value.calls.length, 2, label);
  }
});

test("null and misaligned out-pointers pass through and record nothing", () => {
  const value = fixture();
  const program = value.env.glCreateProgram!();
  value.env.glGetProgramiv!(program, COMPLETION_STATUS, 0);
  value.env.glGetProgramiv!(program, COMPLETION_STATUS, 3);
  assert.equal(value.calls.length, 2);
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);
  assert.equal(value.calls.length, 3);
});

test("losing the GL context drops every memoized program", () => {
  const value = fixture();
  const program = value.env.glCreateProgram!();
  query(value, program, COMPLETION_STATUS);
  assert.equal(value.reconOf().livePrograms, 1);

  for (const listener of value.listeners.get("gw:graphics-context-reset") ?? []) {
    listener();
  }
  assert.equal(value.reconOf().livePrograms, 0);

  value.calls.length = 0;
  value.answer.value = GL_FALSE;
  assert.equal(query(value, program, COMPLETION_STATUS), GL_FALSE);
  assert.deepEqual(value.calls, [[program, COMPLETION_STATUS]]);
});

test("a missing invalidator leaves every import untouched", () => {
  const bare = fixture({
    omit: ["glGetProgramiv", "glCreateProgram", "glLinkProgram", "glDeleteProgram"],
  });
  assert.equal(bare.warnings.length, 1);
  assert.match(bare.warnings[0] ?? "", /\[warn\]/);

  // The read is present but an invalidator is not: install nothing at all.
  const partial = fixture({ omit: ["glLinkProgram"] });
  assert.equal(partial.warnings.length, 1);
  const program = partial.env.glCreateProgram!();
  assert.equal(query(partial, program, COMPLETION_STATUS), GL_TRUE);
  partial.answer.value = 55;
  assert.equal(query(partial, program, COMPLETION_STATUS), 55);
  assert.equal(partial.calls.length, 2);
});

test("programs beyond the ceiling stay correct by passing through", () => {
  const value = fixture();
  for (let index = 0; index < 1024; index += 1) value.env.glCreateProgram!();
  const overflow = value.env.glCreateProgram!();
  assert.equal(value.reconOf().livePrograms, 1024);

  value.calls.length = 0;
  assert.equal(query(value, overflow, COMPLETION_STATUS), GL_TRUE);
  value.answer.value = 21;
  assert.equal(query(value, overflow, COMPLETION_STATUS), 21);
  assert.equal(value.calls.length, 2);
});

test("hits and misses both return the client's void result", () => {
  const value = fixture();
  const program = value.env.glCreateProgram!();
  assert.equal(value.env.glGetProgramiv!(program, COMPLETION_STATUS, OUT), undefined);
  assert.equal(value.env.glGetProgramiv!(program, COMPLETION_STATUS, OUT), undefined);
  assert.equal(value.env.glGetProgramiv!(program, VALIDATE_STATUS, OUT), undefined);
});

test("a grown WASM heap is followed on both the miss and the hit", () => {
  const value = fixture();
  const program = value.env.glCreateProgram!();
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);

  value.setHeap(new Uint8Array(new ArrayBuffer(8192)));
  value.calls.length = 0;
  assert.equal(query(value, program, COMPLETION_STATUS), GL_TRUE);
  assert.deepEqual(value.calls, []);
});

test("reconnaissance counts the queries that still reach the client", () => {
  const value = fixture();
  const program = value.env.glCreateProgram!();
  // Served from the cache after the first miss, so it never shows here.
  query(value, program, COMPLETION_STATUS);
  query(value, program, COMPLETION_STATUS);
  query(value, program, VALIDATE_STATUS);
  query(value, program, VALIDATE_STATUS);
  query(value, program, INFO_LOG_LENGTH);
  assert.deepEqual(value.reconOf().passThrough, {
    "0x8B83": 2,
    "0x8B84": 1,
  });
});

test("completion polls the cache cannot serve stay visible", () => {
  // Otherwise a poll storm against untracked programs is invisible in both the
  // counters and the recon, which is exactly what they exist to reveal.
  const value = fixture();
  for (let poll = 0; poll < 3; poll += 1) query(value, 42, COMPLETION_STATUS);
  const overflowSafe = value.env.glCreateProgram!();
  value.env.glGetProgramiv!(overflowSafe, COMPLETION_STATUS, 3);
  assert.deepEqual(value.reconOf().passThrough, { "0x91B1": 4 });
  assert.equal(value.calls.length, 4);
});
