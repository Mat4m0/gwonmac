/**
 * Parses the bounded WebAssembly view used by Template-saving semantic proof.
 * It owns binary decoding only and grants no launch authority.
 */
import {
  paddedIndex,
  uleb,
} from "../core/wasm-binary.js";
import {
  signatureEvidence,
  wasmEvidence,
} from "./wasm-evidence.js";
import type { DecodedFunction } from "./enhancement-evidence-types.js";
import type { WasmDataEvidence } from "./wasm-data-evidence.js";

function fail(message: string): never {
  throw new Error(`template-save recertify: ${message}`);
}

export function templateCallNeedle(functionIndex: number): Uint8Array {
  const padded = paddedIndex(functionIndex);
  const needle = new Uint8Array(padded.byteLength + 1);
  needle[0] = 0x10;
  needle.set(padded, 1);
  return needle;
}

/** Parsed module facts shared by every template locator and semantic proof. */
export class TemplateSaveModuleView {
  readonly input: Uint8Array;
  readonly importSection: Uint8Array;
  readonly importCount: number;
  readonly bodies: readonly Uint8Array[];
  readonly signatures: string[];
  readonly zeroInitializedBase: number;
  readonly initialMemoryBytes: number;
  private readonly data: WasmDataEvidence;
  private readonly callerCache = new Map<number, Set<number>>();
  private readonly decoded: readonly DecodedFunction[];

  constructor(input: Uint8Array) {
    this.input = input;
    const evidence = wasmEvidence(input) ?? fail("invalid or unsupported module");
    const module = evidence.moduleView();
    this.importSection = module.importSection ?? fail("missing import section");
    this.importCount = module.functionImportCount;
    this.bodies = module.bodies;
    this.signatures = this.bodies.map((_, local) => {
      const signature = signatureEvidence(module, this.functionIndex(local))
        ?? fail(`unknown type for function ${local}`);
      return `(${signature.params.join(",")})->(${signature.results.join(",")})`;
    });
    if (this.signatures.length !== this.bodies.length) {
      fail("function and code sections disagree");
    }
    this.data = evidence.data;
    this.zeroInitializedBase = this.data.zeroInitializedBase;
    this.initialMemoryBytes = this.data.initialMemoryBytes;
    this.decoded = evidence.decodeFunctions([]);
  }

  functionIndex(local: number): number {
    return this.importCount + local;
  }

  callers(functionIndex: number): Set<number> {
    const cached = this.callerCache.get(functionIndex);
    if (cached) return new Set(cached);
    const found = new Set<number>();
    this.decoded.forEach((body, local) => {
      if ((body.calls.get(functionIndex) ?? 0) > 0) found.add(local);
    });
    this.callerCache.set(functionIndex, found);
    return new Set(found);
  }

  callSites(caller: number, functionIndex: number): number[] {
    const body = this.decoded[caller] ?? fail(`function ${caller} is out of range`);
    return (body.callSites.get(functionIndex) ?? [])
      .filter((site) => site.operandEnd - site.offset === 6)
      .map((site) => site.offset);
  }

  encodedCallCount(functionIndex: number, width: number): number {
    return this.decoded.reduce((total, body) => total
      + (body.callSites.get(functionIndex) ?? [])
        .filter((site) => site.operandEnd - site.offset === width).length, 0);
  }

  readString(address: number): string | null {
    return this.data.readCString(address);
  }

  readData(address: number, length: number): Uint8Array | null {
    return this.data.readBytes(address, length);
  }

  dataOccurrenceCount(needle: Uint8Array): number {
    return this.data.addresses(needle).length;
  }

  dataAddresses(needle: Uint8Array): readonly number[] {
    return this.data.addresses(needle);
  }

  containsInitializedData(address: number): boolean {
    return this.data.contains(address);
  }

  stringOccurrenceCount(value: string): number {
    const needle = new TextEncoder().encode(`${value}\0`);
    return this.data.addresses(needle).length;
  }
}

/** Possible canonical calls are diagnostic only; exact padded call counts gate. */
export function canonicalTemplateCallCount(
  view: TemplateSaveModuleView,
  functionIndex: number,
): number {
  const width = uleb(functionIndex).byteLength + 1;
  return view.encodedCallCount(functionIndex, width);
}

export function intersectFunctionSets(
  left: Set<number>,
  right: Set<number>,
): number[] {
  return [...left].filter((value) => right.has(value)).sort((a, b) => a - b);
}

export function onlyFunction(
  candidates: readonly number[],
  what: string,
  extra = "",
): number {
  if (candidates.length === 1) return candidates[0]!;
  fail(
    `expected exactly one ${what}, found ${candidates.length}`
      + ` [${candidates.join(", ")}]${extra ? `. ${extra}` : ""}`,
  );
}
