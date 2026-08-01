/**
 * ArenaNet's client uses KHR_parallel_shader_compile and polls
 * glGetProgramiv(program, COMPLETION_STATUS_KHR) in a loop while a program
 * compiles asynchronously. Chromium cannot answer that from its client-side
 * cache, so every poll flushes the command buffer and waits on the GPU
 * process. A recon session measured 36,713 polls against roughly 250 programs.
 *
 * Completion is the only thing memoized, and only once it reads true, and only
 * while the host has seen the program created and not deleted. Everything else
 * is passed through, including enums this file does not know about.
 */
const COMPLETION_STATUS_KHR = 0x91b1;
const GL_TRUE = 1;

// Deliberately not cached, and each for its own reason:
//   LINK_STATUS and friends   the client asks each exactly once per program
//                             (measured: 690 queries, 0 repeats), so caching
//                             them buys nothing.
//   VALIDATE_STATUS (0x8B83)  evaluated against current GL state, not the
//                             program — no invalidation set can exist.
//   INFO_LOG_LENGTH (0x8B84)  rewritten by link and validate, and a stale
//                             log would hide link failures.
//   the *_MAX_LENGTH trio     already memoized on the program object by the
//                             generated glue; they never reach GL twice.

// A ceiling, not an LRU. Evicting would reintroduce the round trips this
// exists to remove; overflow degrades to pass-through, never to wrong.
const MAX_PROGRAMS = 1024;

// The four entry points this cache touches, out of an import table it neither
// reads nor patches otherwise. Each is optional because absence is the case the
// guard below exists for. Only the arguments this file inspects are named; the
// trailing rest and the `unknown` results say that everything the generated
// glue does beyond them is forwarded untouched rather than understood here.
type GlProgramImports = {
  glGetProgramiv?: (program: number, pname: number, out: number) => unknown;
  glCreateProgram?: (...args: unknown[]) => unknown;
  glLinkProgram?: (program: number, ...rest: unknown[]) => unknown;
  glDeleteProgram?: (program: number, ...rest: unknown[]) => unknown;
};

export const installGlProgramCache = ({
  imports,
  module,
  log,
}: {
  imports: { env?: GlProgramImports };
  module: { HEAPU8?: Uint8Array };
  log: (...values: unknown[]) => void;
}) => {
  const env = imports.env;
  const getProgramiv = env?.glGetProgramiv;
  const createProgram = env?.glCreateProgram;
  const linkProgram = env?.glLinkProgram;
  const deleteProgram = env?.glDeleteProgram;
  // All four or none. A read cache without its invalidators is a rendering
  // bug, so there is no useful degraded mode between them.
  if (
    !env ||
    typeof getProgramiv !== 'function' ||
    typeof createProgram !== 'function' ||
    typeof linkProgram !== 'function' ||
    typeof deleteProgram !== 'function'
  ) {
    log('[warn] GL program state cache unavailable — imports left unpatched');
    return;
  }

  // program name -> has completed. An entry exists exactly while the host has
  // seen the name created and not deleted, so a recycled id starts cold and a
  // name we never saw created passes through forever — which matters, because
  // the glue's "program >= GL.counter" branch writes nothing at all, so
  // recording the out-pointer there would capture whatever was in memory.
  const programs = new Map<number, boolean>();

  // Queries that still reach the client, by pname, so a hot one we do not
  // cache stays visible after an ArenaNet client update.
  const passThrough = new Map<number, number>();
  const countPassThrough = (pname: number) =>
    passThrough.set(pname, (passThrough.get(pname) ?? 0) + 1);

  let backing: ArrayBufferLike | null = null;
  let words: Int32Array | null = null;
  function heap() {
    const bytes = module.HEAPU8;
    if (!bytes) return null;
    // Growth replaces the buffer, so identity is the whole check.
    if (bytes.buffer !== backing) {
      backing = bytes.buffer;
      words = new Int32Array(bytes.buffer);
    }
    return words;
  }

  env.glCreateProgram = function (this: unknown, ...args) {
    const program = createProgram.apply(this, args);
    if (typeof program === 'number' && program > 0 && programs.size < MAX_PROGRAMS) {
      programs.set(program, false);
    }
    return program;
  };

  env.glLinkProgram = function (this: unknown, program, ...rest) {
    // Relinking restarts the asynchronous compile, so completion is false
    // again until the client observes otherwise.
    if (programs.has(program)) programs.set(program, false);
    return linkProgram.call(this, program, ...rest);
  };

  env.glDeleteProgram = function (this: unknown, program, ...rest) {
    programs.delete(program);
    return deleteProgram.call(this, program, ...rest);
  };

  env.glGetProgramiv = function (this: unknown, program, pname, p) {
    if (pname !== COMPLETION_STATUS_KHR) {
      countPassThrough(pname);
      return getProgramiv.call(this, program, pname, p);
    }
    const completed = programs.get(program);
    const words32 = heap();
    const index = p >>> 2;
    if (
      completed === undefined ||
      words32 === null ||
      !p ||
      (p & 3) !== 0 ||
      index >= words32.length
    ) {
      // A completion poll we cannot serve is still a poll reaching the
      // client; counting it keeps a storm against untracked programs visible.
      countPassThrough(pname);
      return getProgramiv.call(this, program, pname, p);
    }
    if (completed) {
      words32[index] = GL_TRUE;
      window.gwDiagnostics?.glProgramQuery(true);
      return undefined;
    }
    getProgramiv.call(this, program, pname, p);
    // Re-read through heap(): the underlying call can grow memory, which
    // detaches the view the miss started with.
    const after = heap();
    // Only a true completion is recorded. False is the answer the client is
    // polling for a change in, so freezing it would leave it polling a
    // program that never finishes. True is terminal until the next
    // glLinkProgram, which clears the entry.
    if (after !== null && after[index] === GL_TRUE) programs.set(program, true);
    window.gwDiagnostics?.glProgramQuery(false);
    return undefined;
  };

  // Programs do not survive the context, so neither may their completion.
  addEventListener('gw:graphics-context-reset', () => programs.clear());

  // Which queries still reach the client, and how often. Read it with
  // gwGlRecon() after a play session to re-check the allowlist against a
  // freshly downloaded client.
  window.gwGlRecon = () => ({
    livePrograms: programs.size,
    passThrough: Object.fromEntries(
      [...passThrough]
        .sort((left, right) => right[1] - left[1])
        .map(([pname, count]): [string, number] => [
          `0x${pname.toString(16).toUpperCase()}`,
          count,
        ]),
    ),
  });
};
