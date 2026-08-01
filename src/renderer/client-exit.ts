/**
 * ArenaNet's client does not exit its Emscripten runtime when the player uses
 * the in-game X. Its exported main-loop callback performs the client's cleanup,
 * stops scheduling itself, and resolves successfully. `Module.onExit` therefore
 * never runs even though the client has finished.
 *
 * Own only that missing edge. `emscripten_async_call` is still ArenaNet's
 * scheduler for every other callback. The main loop is identified by function
 * identity against both the exported function and its table entry — the same
 * identity Emscripten's JSPI glue uses before wrapping the callback with
 * `WebAssembly.promising`. If a future client changes that contract, this
 * adapter delegates unchanged instead of guessing.
 */

type WasmCallback = (...args: number[]) => unknown;
type PromisingCallback = (...args: number[]) => Promise<unknown>;
type AsyncCall = (callback: number, argument: number, milliseconds: number) => void;

export type ClientExitImports = WebAssembly.Imports & {
  env?: WebAssembly.ModuleImports & {
    emscripten_async_call?: AsyncCall;
  };
};

interface ClientInstance {
  readonly exports: WebAssembly.Exports;
}

interface ClientExitOptions {
  readonly imports: ClientExitImports;
  readonly instance: () => ClientInstance | null;
  readonly onExit: () => void | Promise<void>;
  readonly onFailure: (error: unknown) => void;
  readonly log: (...values: unknown[]) => void;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly promising?: (callback: WasmCallback) => PromisingCallback;
}

export function installClientExit(options: ClientExitOptions): void {
  const { env } = options.imports;
  const original = env?.emscripten_async_call;
  if (!env || typeof original !== "function") {
    options.log("[warn] no emscripten_async_call import — clean client exit unavailable");
    return;
  }

  const requestFrame =
    options.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const promising =
    options.promising
    ?? (callback =>
      (
        WebAssembly as typeof WebAssembly & {
          promising(value: WasmCallback): PromisingCallback;
        }
      ).promising(callback));

  let mainLoop: WasmCallback | null = null;
  let promisingMainLoop: PromisingCallback | null = null;
  let scheduleGeneration = 0;
  let settled = false;

  const fail = (error: unknown): void => {
    if (settled) return;
    settled = true;
    options.onFailure(error);
  };

  env.emscripten_async_call = (callback, argument, milliseconds) => {
    const instance = options.instance();
    const table = instance?.exports.__indirect_function_table;
    const exportedMainLoop = instance?.exports.EmscriptenExeThreadMainLoop;
    const tableCallback =
      table instanceof WebAssembly.Table ? table.get(callback) : null;

    if (
      milliseconds >= 0
      || typeof exportedMainLoop !== "function"
      || tableCallback !== exportedMainLoop
    ) {
      original(callback, argument, milliseconds);
      return;
    }

    if (settled) return;
    const callableMainLoop = exportedMainLoop as WasmCallback;
    if (mainLoop !== callableMainLoop) {
      mainLoop = callableMainLoop;
      promisingMainLoop = promising(callableMainLoop);
    }

    const generation = ++scheduleGeneration;
    requestFrame(() => {
      const run = promisingMainLoop;
      if (!run) {
        fail(new Error("clean client exit lost the main-loop callback"));
        return;
      }
      void run(argument).then(
        () => {
          // A running tick schedules the next generation before it resolves.
          // The client's termination tick completes its cleanup and does not.
          if (settled || generation !== scheduleGeneration) return;
          settled = true;
          void Promise.resolve(options.onExit()).catch(options.onFailure);
        },
        fail,
      );
    });
  };
}
