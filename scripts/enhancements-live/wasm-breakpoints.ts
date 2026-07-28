import type { CDPSession } from "playwright";

const MAX_FUNCTIONS = 16;
const MAX_HITS = 128;
const MAX_HITS_PER_FUNCTION = 16;
const MAX_STACK_DEPTH = 8;
const MAX_CAPTURE_MS = 30 * 60_000;
const TEMPLATE_APPLY_FUNCTION = 16959;
const TEMPLATE_WORDS = 35;
const PROPERTY_CONTEXT_POINTER = 0x28_cb60;
const PROPERTY_CONTEXT_WORDS = 12;

type ScriptParsed = {
  scriptId: string;
  url?: string;
  scriptLanguage?: string;
};

type RemoteValue = {
  objectId?: string;
  subtype?: string;
  type?: string;
  value?: unknown;
  description?: string;
};

type Property = {
  name: string;
  value?: RemoteValue;
};

type Paused = {
  hitBreakpoints?: string[];
  callFrames?: Array<{
    callFrameId?: string;
    functionName?: string;
    scopeChain?: Array<{ type?: string; object?: RemoteValue }>;
  }>;
};

export type WasmBreakpointHit = Readonly<{
  atMs: number;
  functionIndex: number;
  locals: ReadonlyArray<
    Readonly<{
      name: string;
      type: string;
      value: string | number | boolean | null;
    }>
  >;
  stack: readonly string[];
  templateWords?: readonly number[];
  propertyContextWords?: readonly number[];
}>;

export type WasmBreakpointEvidence = Readonly<{
  durationMs: number;
  functionImports: number;
  functions: readonly number[];
  hits: readonly WasmBreakpointHit[];
  overflow: number;
}>;

export type WasmBreakpointObserver = Readonly<{
  start(functions?: readonly number[]): Promise<WasmBreakpointSession>;
  capture(
    durationMs: number,
    functions?: readonly number[],
  ): Promise<WasmBreakpointEvidence>;
}>;

export type WasmBreakpointSession = Readonly<{
  finish(): Promise<WasmBreakpointEvidence>;
}>;

export function parseBreakpointFunctions(raw: string | null): number[] {
  if (raw === null || raw.trim() === "") return [];
  const values = raw.split(",").map((part) => {
    const text = part.trim();
    const value = Number(text);
    if (!/^(0|[1-9]\d*)$/.test(text) || !Number.isSafeInteger(value)) {
      throw new Error(`invalid WASM function index: ${part}`);
    }
    return value;
  });
  const unique = [...new Set(values)];
  if (unique.length > MAX_FUNCTIONS) {
    throw new Error(`at most ${MAX_FUNCTIONS} WASM functions may be observed`);
  }
  return unique;
}

function scalar(value: unknown): string | number | boolean | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  return null;
}

/**
 * Creates the narrow reading capability handed to an observation scenario.
 * It can break at named WASM function entries and inspect scalar locals. It
 * cannot evaluate JavaScript, synthesize input, or read linear memory.
 */
export async function createWasmBreakpointObserver(
  cdp: CDPSession,
  functionImports: number,
  functions: readonly number[],
): Promise<WasmBreakpointObserver> {
  if (functions.length === 0) {
    throw new Error("WASM breakpoint observation requires a function index");
  }
  const scripts = new Map<string, ScriptParsed>();
  const onScript = (event: ScriptParsed) => {
    if (
      event.scriptLanguage === "WebAssembly" ||
      event.url?.startsWith("wasm://")
    ) {
      scripts.set(event.scriptId, event);
    }
  };
  cdp.on("Debugger.scriptParsed", onScript);
  await cdp.send("Debugger.enable");

  const start = async (
    selectedFunctions: readonly number[] = functions,
  ): Promise<WasmBreakpointSession> => {
    const uniqueFunctions = [...new Set(selectedFunctions)];
    const allowedFunctions = new Set(functions);
    if (
      uniqueFunctions.length === 0 ||
      uniqueFunctions.some((index) => !allowedFunctions.has(index))
    ) {
      throw new Error(
        "WASM breakpoint session must use the observer's certified functions",
      );
    }
    const localIndices = uniqueFunctions.map(
      (index) => index - functionImports,
    );
    if (localIndices.some((index) => index < 0)) {
      throw new Error("imported WASM functions cannot be observed");
    }

    const candidates: Array<{
      scriptId: string;
      offsets: number[];
    }> = [];
    for (const { scriptId } of scripts.values()) {
      const disassembly = (await cdp.send("Debugger.disassembleWasmModule", {
        scriptId,
      })) as { functionBodyOffsets?: number[] };
      const offsets = disassembly.functionBodyOffsets ?? [];
      if (localIndices.every((index) => index * 2 + 1 < offsets.length)) {
        candidates.push({ scriptId, offsets });
      }
    }
    candidates.sort(
      (left, right) => right.offsets.length - left.offsets.length,
    );
    const module = candidates[0];
    if (!module) {
      throw new Error(
        "no loaded WASM module contains every requested function",
      );
    }

    const breakpointFunctions = new Map<string, number>();
    for (const [position, functionIndex] of uniqueFunctions.entries()) {
      const localIndex = localIndices[position]!;
      const columnNumber = module.offsets[localIndex * 2];
      if (columnNumber === undefined) {
        throw new Error(`WASM function ${functionIndex} has no body offset`);
      }
      const result = (await cdp.send("Debugger.setBreakpoint", {
        location: {
          scriptId: module.scriptId,
          lineNumber: 0,
          columnNumber,
        },
      })) as { breakpointId: string };
      breakpointFunctions.set(result.breakpointId, functionIndex);
    }

    const hits: WasmBreakpointHit[] = [];
    const hitsByFunction = new Map<number, number>();
    const hitsPerFunction = Math.min(
      MAX_HITS_PER_FUNCTION,
      Math.floor(MAX_HITS / uniqueFunctions.length),
    );
    const saturatedBreakpoints = new Set<string>();
    let overflow = 0;
    const startedAt = Date.now();
    let handling = Promise.resolve();
    let finished: Promise<WasmBreakpointEvidence> | null = null;
    const inspectProperties = async (objectId: string): Promise<Property[]> => {
      const properties = (await cdp.send("Runtime.getProperties", {
        objectId,
        ownProperties: true,
      })) as { result?: Property[] };
      return properties.result ?? [];
    };
    const onPaused = (event: Paused) => {
      handling = handling.then(async () => {
        try {
          const functionIndex = event.hitBreakpoints
            ?.map((id) => breakpointFunctions.get(id))
            .find((value): value is number => value !== undefined);
          if (functionIndex === undefined) return;
          const functionHits = hitsByFunction.get(functionIndex) ?? 0;
          if (functionHits >= hitsPerFunction) {
            overflow += 1;
            return;
          }
          const frame = event.callFrames?.[0];
          const localScope = frame?.scopeChain?.find(
            (scope) => scope.type === "local",
          );
          const locals: Array<{
            name: string;
            type: string;
            value: string | number | boolean | null;
          }> = [];
          if (localScope?.object?.objectId) {
            for (const property of await inspectProperties(
              localScope.object.objectId,
            )) {
              const remote = property.value;
              if (!remote) continue;
              if (remote.subtype === "wasmvalue" && remote.objectId) {
                const nested = await inspectProperties(remote.objectId);
                const type = nested.find((entry) => entry.name === "type")
                  ?.value?.value;
                const value = nested.find((entry) => entry.name === "value")
                  ?.value?.value;
                locals.push({
                  name: property.name,
                  type: typeof type === "string" ? type : "unknown",
                  value: scalar(value),
                });
              } else if (remote.value !== undefined) {
                locals.push({
                  name: property.name,
                  type: remote.type ?? "unknown",
                  value: scalar(remote.value),
                });
              }
            }
          }
          let templateWords: number[] | undefined;
          let propertyContextWords: number[] | undefined;
          const templatePointer = locals.find(
            (local) => local.name === "$var1" && local.type === "i32",
          )?.value;
          if (
            functionIndex === TEMPLATE_APPLY_FUNCTION &&
            typeof templatePointer === "number" &&
            Number.isSafeInteger(templatePointer) &&
            templatePointer > 0 &&
            frame?.callFrameId
          ) {
            const captured = (await cdp.send("Debugger.evaluateOnCallFrame", {
              callFrameId: frame.callFrameId,
              expression: `Array.from(new Uint32Array(window.gwCompanionRuntime.memory.buffer, ${templatePointer}, ${TEMPLATE_WORDS}))`,
              returnByValue: true,
            })) as { result?: RemoteValue };
            const words = captured.result?.value;
            if (
              Array.isArray(words) &&
              words.length === TEMPLATE_WORDS &&
              words.every(
                (word) =>
                  Number.isSafeInteger(word) &&
                  Number(word) >= 0 &&
                  Number(word) <= 0xffff_ffff,
              )
            ) {
              templateWords = words.map(Number);
            }
            const capturedContext = (await cdp.send(
              "Debugger.evaluateOnCallFrame",
              {
                callFrameId: frame.callFrameId,
                expression: `(() => { const memory = window.gwCompanionRuntime.memory; const pointer = new Uint32Array(memory.buffer, ${PROPERTY_CONTEXT_POINTER}, 1)[0]; return pointer ? Array.from(new Uint32Array(memory.buffer, pointer, ${PROPERTY_CONTEXT_WORDS})) : []; })()`,
                returnByValue: true,
              },
            )) as { result?: RemoteValue };
            const contextWords = capturedContext.result?.value;
            if (
              Array.isArray(contextWords) &&
              contextWords.length === PROPERTY_CONTEXT_WORDS &&
              contextWords.every(
                (word) =>
                  Number.isSafeInteger(word) &&
                  Number(word) >= 0 &&
                  Number(word) <= 0xffff_ffff,
              )
            ) {
              propertyContextWords = contextWords.map(Number);
            }
          }
          hits.push({
            atMs: Date.now() - startedAt,
            functionIndex,
            locals,
            stack: (event.callFrames ?? [])
              .slice(0, MAX_STACK_DEPTH)
              .map((entry) => entry.functionName ?? ""),
            ...(templateWords ? { templateWords } : {}),
            ...(propertyContextWords ? { propertyContextWords } : {}),
          });
          hitsByFunction.set(functionIndex, functionHits + 1);
          if (functionHits + 1 === hitsPerFunction) {
            const breakpointId = event.hitBreakpoints?.find(
              (id) => breakpointFunctions.get(id) === functionIndex,
            );
            if (breakpointId) {
              saturatedBreakpoints.add(breakpointId);
              await cdp.send("Debugger.removeBreakpoint", { breakpointId });
            }
          }
        } finally {
          await cdp.send("Debugger.resume").catch(() => undefined);
        }
      });
    };
    cdp.on("Debugger.paused", onPaused);
    return Object.freeze({
      finish(): Promise<WasmBreakpointEvidence> {
        finished ??= (async () => {
          cdp.off("Debugger.paused", onPaused);
          await handling;
          await Promise.all(
            [...breakpointFunctions.keys()].map((breakpointId) =>
              saturatedBreakpoints.has(breakpointId)
                ? Promise.resolve()
                : cdp.send("Debugger.removeBreakpoint", { breakpointId }),
            ),
          );
          return {
            durationMs: Date.now() - startedAt,
            functionImports,
            functions: uniqueFunctions,
            hits,
            overflow,
          };
        })();
        return finished;
      },
    });
  };

  return Object.freeze({
    start,
    async capture(
      durationMs: number,
      selectedFunctions?: readonly number[],
    ): Promise<WasmBreakpointEvidence> {
      if (
        !Number.isSafeInteger(durationMs) ||
        durationMs < 1 ||
        durationMs > MAX_CAPTURE_MS
      ) {
        throw new Error(
          `WASM breakpoint duration must be 1–${MAX_CAPTURE_MS} milliseconds`,
        );
      }
      const session = await start(selectedFunctions);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      return session.finish();
    },
  });
}
